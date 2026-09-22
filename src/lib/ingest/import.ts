import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { assertPermission } from "@/lib/auth/context";
import { MutationError } from "@/lib/services/mutate";
import { recordActivity, recordAudit } from "@/lib/services/audit";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";

/**
 * Manual lead import.
 *
 * The one ingestion path that needs no external service. Rows go through the
 * same entity resolution and scoring as anything else, so an imported lead is
 * not a second-class record.
 *
 * §102 — duplicates are detected rather than silently merged or silently
 * duplicated. A row matching an existing person is reported as such and skipped.
 */

export const importRowSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  companyName: z.string().trim().min(1).max(200),
  title: z.string().trim().max(160).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional(),
  linkedinUrl: z.string().trim().url().max(400).optional().or(z.literal("")),
  domain: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  employeeCount: z.coerce.number().int().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(1000).optional(),
});

export type ImportRow = z.infer<typeof importRowSchema>;

export const importRequestSchema = z
  .object({
    /** Already-parsed rows, e.g. from an API client. */
    rows: z.array(importRowSchema).max(500).optional(),
    /** Raw pasted CSV/TSV — parsed here so the rows never round-trip. */
    text: z.string().max(500_000).optional(),
    icpProfileId: z.string().uuid().optional(),
    /** Records where the list came from, so provenance survives. */
    sourceLabel: z.string().trim().min(1).max(200).default("Manual import"),
    assignToMe: z.boolean().default(true),
  })
  .refine((v) => (v.rows?.length ?? 0) > 0 || (v.text?.trim().length ?? 0) > 0, {
    message: "Provide either parsed rows or the raw text to parse.",
  });

export type ImportResult = {
  imported: number;
  skipped: { row: number; name: string; reason: string }[];
  leadIds: string[];
  rescoreQueued: boolean;
  note: string;
};

/** Normalises a name for duplicate comparison — case and spacing only. */
function normaliseName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Derives a company domain when one was not supplied. */
function guessDomain(companyName: string, email?: string): string | null {
  if (email && email.includes("@")) {
    const domain = email.split("@")[1];
    // Free mail domains say nothing about the company.
    const free = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "rediffmail.com", "icloud.com"];
    if (domain && !free.includes(domain)) return domain;
  }
  void companyName;
  return null;
}

export async function importLeads(
  ctx: AuthContext,
  raw: z.input<typeof importRequestSchema>
): Promise<ImportResult> {
  assertPermission(ctx, PERMISSIONS.LEADS_EDIT);
  const input = importRequestSchema.parse(raw);

  // Text is parsed here so the browser never has to send 500 rows back.
  const rows = input.rows?.length ? input.rows : parseDelimited(input.text ?? "").rows;
  if (rows.length === 0) {
    throw new MutationError(
      "Nothing usable in that list. A header row naming at least 'name' and 'company' is the most reliable format.",
      "nothing_to_import",
      400
    );
  }
  if (rows.length > 500) {
    throw new MutationError(
      `That list has ${rows.length} rows. Import up to 500 at a time so a failure part-way through is recoverable.`,
      "too_many_rows",
      400
    );
  }

  const icp = input.icpProfileId
    ? await db.icpProfile.findFirst({
        where: { id: input.icpProfileId, workspaceId: ctx.workspaceId, deletedAt: null },
      })
    : await db.icpProfile.findFirst({
        where: { workspaceId: ctx.workspaceId, deletedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      });

  if (!icp) {
    throw new MutationError(
      "Define an ICP first — without one there is nothing to score these leads against, and an unscored lead is just a row.",
      "no_icp",
      409
    );
  }

  // A dedicated phrase per import batch, so attribution works the same way as
  // it does for discovered leads.
  const phrase = await db.searchPhrase.create({
    data: {
      workspaceId: ctx.workspaceId,
      phrase: input.sourceLabel,
      sourceKind: "USER_MANUAL",
      isActive: false,
      cadenceHours: 24,
      negativeKeywords: [],
      createdByAi: false,
    },
  });

  const run = await db.searchRun.create({
    data: {
      workspaceId: ctx.workspaceId,
      searchPhraseId: phrase.id,
      state: "RUNNING",
      idempotencyKey: randomUUID(),
    },
  });

  const skipped: ImportResult["skipped"] = [];
  const leadIds: string[] = [];
  let duplicates = 0;

  for (const [index, row] of rows.entries()) {
    try {
      // --- company: match on domain first, then exact name ------------------
      const domain = row.domain?.toLowerCase() || guessDomain(row.companyName, row.email || undefined);

      let company = domain
        ? await db.company.findFirst({
            where: { workspaceId: ctx.workspaceId, domain, deletedAt: null },
          })
        : null;

      if (!company) {
        company = await db.company.findFirst({
          where: {
            workspaceId: ctx.workspaceId,
            deletedAt: null,
            name: { equals: row.companyName, mode: "insensitive" },
          },
        });
      }

      if (!company) {
        company = await db.company.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: row.companyName,
            domain: domain ?? null,
            industry: row.industry ?? null,
            city: row.city ?? null,
            state: row.state ?? null,
            employeeCount: row.employeeCount ?? null,
            country: "India",
            technologies: [],
            tags: ["imported"],
          },
        });
      } else if (row.employeeCount && !company.employeeCount) {
        // Fill a gap the import can answer; never overwrite existing data.
        await db.company.update({
          where: { id: company.id },
          data: {
            employeeCount: row.employeeCount,
            industry: company.industry ?? row.industry ?? null,
            city: company.city ?? row.city ?? null,
          },
        });
      }

      // --- person: LinkedIn URL, then email, then name at the same company ---
      let person = row.linkedinUrl
        ? await db.person.findFirst({
            where: { workspaceId: ctx.workspaceId, linkedinUrl: row.linkedinUrl, deletedAt: null },
          })
        : null;

      if (!person && row.email) {
        const byEmail = await db.contactMethod.findFirst({
          where: { workspaceId: ctx.workspaceId, value: row.email },
          include: { person: true },
        });
        person = byEmail?.person ?? null;
      }

      if (!person) {
        const candidates = await db.person.findMany({
          where: {
            workspaceId: ctx.workspaceId,
            deletedAt: null,
            employments: { some: { companyId: company.id, isCurrent: true } },
          },
        });
        person =
          candidates.find((c) => normaliseName(c.fullName) === normaliseName(row.fullName)) ?? null;
      }

      if (person) {
        const existingLead = await db.lead.findFirst({
          where: {
            workspaceId: ctx.workspaceId,
            personId: person.id,
            companyId: company.id,
            deletedAt: null,
          },
        });
        if (existingLead) {
          duplicates++;
          skipped.push({
            row: index + 1,
            name: row.fullName,
            reason: `Already a lead at ${company.name}. Nothing was overwritten.`,
          });
          continue;
        }
      } else {
        const [firstName, ...rest] = row.fullName.trim().split(/\s+/);
        person = await db.person.create({
          data: {
            workspaceId: ctx.workspaceId,
            fullName: row.fullName.trim(),
            firstName,
            lastName: rest.join(" ") || null,
            headline: row.title ? `${row.title} at ${company.name}` : null,
            linkedinUrl: row.linkedinUrl || null,
            city: row.city ?? null,
            state: row.state ?? null,
            country: "India",
            languages: [],
          },
        });
      }

      // Employment has no unique constraint on (person, company), so this is a
      // lookup-then-create rather than an upsert.
      const employment = await db.employment.findFirst({
        where: { workspaceId: ctx.workspaceId, personId: person.id, companyId: company.id },
      });
      if (!employment) {
        await db.employment.create({
          data: {
            workspaceId: ctx.workspaceId,
            personId: person.id,
            companyId: company.id,
            title: row.title || "Unknown",
            isCurrent: true,
            isDecisionMaker: false,
          },
        });
      } else if (row.title && employment.title === "Unknown") {
        await db.employment.update({
          where: { id: employment.id },
          data: { title: row.title },
        });
      }

      // --- contact methods: unlocked, because the user already had them -----
      if (row.email) {
        const exists = await db.contactMethod.findFirst({
          where: { workspaceId: ctx.workspaceId, personId: person.id, value: row.email },
        });
        if (!exists) {
          await db.contactMethod.create({
            data: {
              workspaceId: ctx.workspaceId,
              personId: person.id,
              kind: "WORK_EMAIL",
              value: row.email,
              maskedValue: `${row.email.slice(0, 2)}•••@${row.email.split("@")[1]}`,
              // Imported, so nothing is locked — no point is charged for data
              // the user supplied themselves.
              isLocked: false,
              isPrimary: true,
              status: "UNVERIFIED",
              confidence: 50,
              source: input.sourceLabel,
              revealedAt: new Date(),
              revealedByUserId: ctx.userId,
            },
          });
        }
      }
      if (row.phone) {
        const exists = await db.contactMethod.findFirst({
          where: { workspaceId: ctx.workspaceId, personId: person.id, value: row.phone },
        });
        if (!exists) {
          await db.contactMethod.create({
            data: {
              workspaceId: ctx.workspaceId,
              personId: person.id,
              kind: "MOBILE",
              value: row.phone,
              maskedValue: `${row.phone.slice(0, 5)}•••••`,
              isLocked: false,
              status: "UNVERIFIED",
              confidence: 50,
              source: input.sourceLabel,
              revealedAt: new Date(),
              revealedByUserId: ctx.userId,
            },
          });
        }
      }
      if (row.linkedinUrl) {
        const exists = await db.contactMethod.findFirst({
          where: { workspaceId: ctx.workspaceId, personId: person.id, kind: "LINKEDIN_URL" },
        });
        if (!exists) {
          await db.contactMethod.create({
            data: {
              workspaceId: ctx.workspaceId,
              personId: person.id,
              kind: "LINKEDIN_URL",
              value: row.linkedinUrl,
              maskedValue: "linkedin.com/in/•••",
              isLocked: false,
              status: "LIKELY",
              confidence: 70,
              source: input.sourceLabel,
            },
          });
        }
      }

      const lead = await db.lead.create({
        data: {
          workspaceId: ctx.workspaceId,
          personId: person.id,
          companyId: company.id,
          icpProfileId: icp.id,
          ownerId: input.assignToMe ? ctx.userId : null,
          status: "NEW",
          // Left at defaults: the scoring job assigns tier and intent from
          // evidence. Guessing here would be inventing a score.
          surfacedReason: `Imported from "${input.sourceLabel}" — not yet scored against a buying signal`,
          sourcePhraseId: phrase.id,
          surfacedAt: new Date(),
          lastActivityAt: new Date(),
        },
      });
      leadIds.push(lead.id);

      if (row.note) {
        await db.note.create({
          data: {
            workspaceId: ctx.workspaceId,
            body: row.note,
            authorId: ctx.userId,
            leadId: lead.id,
            companyId: company.id,
          },
        });
      }

      // A manual-note signal, so the lead's timeline is not empty and the
      // provenance is on the record.
      await db.signal.create({
        data: {
          workspaceId: ctx.workspaceId,
          leadId: lead.id,
          personId: person.id,
          companyId: company.id,
          type: "MANUAL_NOTE",
          sourceKind: "USER_MANUAL",
          sourceName: input.sourceLabel,
          title: `Added by ${ctx.user.name} from "${input.sourceLabel}"`,
          excerpt:
            row.note ??
            "Imported from a list. No buying signal has been observed for this person yet.",
          aiInterpretation:
            "Imported rather than discovered, so there is no behavioural evidence behind it. Intent stays cold until a real signal appears.",
          confidence: 30,
          intentDelta: 0,
          keywords: [],
          occurredAt: new Date(),
          searchPhraseId: phrase.id,
          dedupeHash: createHash("sha256")
            .update(`import-${ctx.workspaceId}-${person.id}-${company.id}`)
            .digest("hex")
            .slice(0, 32),
        },
      });
    } catch (err) {
      skipped.push({
        row: index + 1,
        name: row.fullName,
        reason: (err as Error).message.slice(0, 160),
      });
    }
  }

  await db.searchRun.update({
    where: { id: run.id },
    data: {
      state: "SUCCEEDED",
      signalsFound: leadIds.length,
      leadsCreated: leadIds.length,
      duplicates,
      finishedAt: new Date(),
    },
  });

  // Imported leads have no score until the engine runs.
  const rescore = await enqueue(
    JOB.RESCORE_WORKSPACE,
    { workspaceId: ctx.workspaceId, reason: `imported ${leadIds.length} leads` },
    { dedupeKey: `rescore-ws-${ctx.workspaceId}`, dedupeWindowSec: 30 }
  );

  await Promise.all([
    recordAudit(ctx, {
      action: "leads.imported",
      objectType: "SearchRun",
      objectId: run.id,
      after: {
        sourceLabel: input.sourceLabel,
        imported: leadIds.length,
        skipped: skipped.length,
      },
    }),
    recordActivity(ctx, {
      kind: "leads.imported",
      summary: `${leadIds.length} ${leadIds.length === 1 ? "lead" : "leads"} imported from "${input.sourceLabel}"`,
      detail:
        skipped.length > 0
          ? `${skipped.length} ${skipped.length === 1 ? "row" : "rows"} skipped, ${duplicates} already existed.`
          : undefined,
    }),
  ]);

  return {
    imported: leadIds.length,
    skipped,
    leadIds,
    rescoreQueued: rescore.queued,
    note: rescore.queued
      ? "Scoring runs in the background — tiers and intent will appear shortly."
      : "No queue is configured, so these leads stay unscored until a worker runs.",
  };
}

/**
 * Parses pasted CSV or TSV into import rows.
 *
 * Reports per-row problems rather than failing the whole paste, because one bad
 * line in two hundred should not cost the user the other hundred and ninety-nine.
 */
export function parseDelimited(text: string): {
  rows: ImportRow[];
  errors: { line: number; reason: string }[];
  detectedColumns: string[];
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { rows: [], errors: [], detectedColumns: [] };

  const delimiter = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? "\t" : ",";

  const split = (line: string) => {
    // Handles quoted fields containing the delimiter.
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === delimiter && !quoted) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };

  const ALIASES: Record<keyof ImportRow, string[]> = {
    fullName: ["name", "full name", "fullname", "contact", "person", "contact name"],
    companyName: ["company", "company name", "organisation", "organization", "account", "employer"],
    title: ["title", "job title", "designation", "role", "position"],
    email: ["email", "email address", "work email", "e-mail"],
    phone: ["phone", "mobile", "phone number", "contact number", "telephone"],
    linkedinUrl: ["linkedin", "linkedin url", "profile", "linkedin profile"],
    domain: ["domain", "website", "company domain", "url"],
    industry: ["industry", "sector", "vertical"],
    city: ["city", "location", "town"],
    state: ["state", "region", "province"],
    employeeCount: ["employees", "employee count", "headcount", "size", "staff"],
    note: ["note", "notes", "comment", "comments", "context"],
  };

  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/[_-]+/g, " ").trim());
  const mapping = new Map<number, keyof ImportRow>();
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof ImportRow, string[]][]) {
    const index = header.findIndex((h) => aliases.includes(h));
    if (index >= 0) mapping.set(index, field);
  }

  // A header is only a header if it named at least the two required fields.
  const hasHeader = [...mapping.values()].includes("fullName") && [...mapping.values()].includes("companyName");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  if (!hasHeader) {
    // Positional fallback, documented in the UI so it is not a surprise.
    mapping.clear();
    (["fullName", "companyName", "title", "email", "phone"] as const).forEach((f, i) =>
      mapping.set(i, f)
    );
  }

  const rows: ImportRow[] = [];
  const errors: { line: number; reason: string }[] = [];

  for (const [i, line] of dataLines.entries()) {
    const cells = split(line);
    const draft: Record<string, unknown> = {};
    for (const [index, field] of mapping) {
      const value = cells[index];
      if (value) draft[field] = value;
    }

    const parsed = importRowSchema.safeParse(draft);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      const issue = parsed.error.issues[0];
      errors.push({
        line: i + (hasHeader ? 2 : 1),
        reason: `${issue.path.join(".") || "row"}: ${issue.message}`,
      });
    }
  }

  return {
    rows,
    errors,
    detectedColumns: hasHeader
      ? [...mapping.values()]
      : ["fullName", "companyName", "title", "email", "phone"].slice(0, split(lines[0]).length),
  };
}
