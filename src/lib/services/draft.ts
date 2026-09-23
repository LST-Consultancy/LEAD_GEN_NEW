import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { complete } from "@/lib/ai/complete";
import { recordAudit } from "@/lib/services/audit";
import {
  SYSTEM_PROMPT,
  buildDraftPrompt,
  parseDraft,
  unknownVariables,
  type DraftChannel,
  type GroundingSection,
} from "@/lib/outreach/draft-prompt";

/**
 * §67 — outreach drafting.
 *
 * Drafting is **not sending**. Nothing here transmits anything, queues anything
 * or marks a lead contacted; it returns text for a person to read, edit and
 * decide on. That separation is why this is a `WRITE` tool and not an
 * `EXTERNAL` one.
 *
 * The grounding is assembled from two places and nothing else:
 *
 *  - the **Knowledge Base**, which bounds what may be claimed about what you
 *    sell, and
 *  - the **lead's own rows** — signals, company facts, what your team wrote —
 *    which bound what may be claimed about them.
 *
 * With neither, the draft is refused rather than generated. A generic email
 * spends the one first impression available and teaches the reader to ignore
 * the sender, so "nothing to say yet" is the better answer.
 */

export const draftInputSchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(["email", "whatsapp", "linkedin"]),
  /** An angle the sender wants taken. Optional; the grounding still binds it. */
  angle: z.string().trim().max(200).optional(),
});

export type DraftInput = z.input<typeof draftInputSchema>;

export type DraftResult =
  | {
      ok: true;
      channel: DraftChannel;
      subject: string | null;
      body: string;
      /** Which grounding headings the draft drew on, as it reported them. */
      groundedOn: string[];
      /** What it could not say for lack of grounding. Null when nothing was held back. */
      withheld: string | null;
      /** Placeholders present in the copy that the renderer knows how to fill. */
      variables: string[];
      model: string;
      costInr: number;
      /** Every grounding line that was supplied, so the draft can be checked against it. */
      grounding: GroundingSection[];
    }
  | { ok: false; code: DraftFailure; reason: string };

export type DraftFailure =
  | "lead_not_found"
  | "no_grounding"
  | "provider_unavailable"
  | "unusable_output"
  | "invented_variables";

export async function draftOutreach(ctx: AuthContext, raw: DraftInput): Promise<DraftResult> {
  const input = draftInputSchema.parse(raw);

  const lead = await db.lead.findFirst({
    where: {
      id: input.leadId,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...leadVisibilityFilter(ctx),
    },
    include: {
      company: true,
      person: true,
      signals: { where: { deletedAt: null }, orderBy: { occurredAt: "desc" }, take: 4 },
      notes: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 3 },
    },
  });

  // Out of tenant and non-existent are the same answer from outside.
  if (!lead) {
    return {
      ok: false,
      code: "lead_not_found",
      reason: "That lead doesn't exist, or you don't have access to it. Nothing was generated.",
    };
  }

  const knowledge = await db.knowledgeDoc.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, isActive: true },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { kind: true, title: true, body: true },
  });

  const grounding = assembleGrounding(lead, knowledge);
  const aboutThem = grounding.find((s) => s.heading === "About this prospect");
  const whatWeSell = grounding.find((s) => s.heading === "What you sell");

  // Both halves are required. Knowing what you sell but nothing about them
  // produces a brochure; knowing about them but not what you sell produces a
  // promise you cannot keep.
  if (!whatWeSell?.lines.length || !aboutThem?.lines.length) {
    return {
      ok: false,
      code: "no_grounding",
      reason: !whatWeSell?.lines.length
        ? "Nothing is written in the Knowledge Base, so a draft would have to invent what you sell. Add one service entry first — that single entry is what keeps a draft honest."
        : "Nothing is recorded about this lead beyond its name, so a draft would be generic. A generic first message spends the one impression you get. Enrich the lead or wait for a signal.",
    };
  }

  const completion = await complete(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    {
      feature: "draft_outreach",
      system: SYSTEM_PROMPT,
      prompt: buildDraftPrompt({ channel: input.channel, sections: grounding, angle: input.angle }),
      maxTokens: 3000,
      // Measured provider latency for this prompt swings between about 7
      // seconds and several minutes. A minute is the point where waiting
      // longer is worse than being told to try again — and a draft is a
      // deliberate action, so it can afford more than a page load.
      timeoutMs: 60_000,
    }
  );

  if (!completion.ok) {
    return { ok: false, code: "provider_unavailable", reason: completion.reason };
  }

  const parsed = parseDraft(completion.text);
  if (!parsed) {
    return {
      ok: false,
      code: "unusable_output",
      reason:
        "The model returned something that wasn't a usable draft. Nothing was saved — try again, or write the opener yourself.",
    };
  }

  // A placeholder the renderer cannot fill would ship with visible braces, so
  // the draft is refused rather than shown with a warning somebody scrolls past.
  const invented = unknownVariables(parsed.body, parsed.subject);
  if (invented.length > 0) {
    return {
      ok: false,
      code: "invented_variables",
      reason: `The draft used placeholders this app can't fill (${invented
        .map((v) => `{{${v}}}`)
        .join(", ")}), which would send with the braces visible. Nothing was saved — try again.`,
    };
  }

  await recordAudit(ctx, {
    action: "outreach.drafted",
    objectType: "Lead",
    objectId: lead.id,
    after: {
      channel: input.channel,
      model: completion.model,
      groundedOn: parsed.groundedOn,
      withheld: parsed.withheld,
    },
    actorType: "HUMAN",
  });

  return {
    ok: true,
    channel: input.channel,
    subject: parsed.subject,
    body: parsed.body,
    groundedOn: parsed.groundedOn,
    withheld: parsed.withheld,
    variables: parsed.variablesUsed,
    model: completion.model,
    costInr: completion.estimatedCostInr,
    grounding,
  };
}

type LeadForDraft = {
  surfacedReason: string;
  company: { name: string; industry: string | null; city: string | null; employeeCount: number | null; technologies: string[] };
  person: { fullName: string; headline: string | null };
  signals: { title: string; excerpt: string; sourceName: string; occurredAt: Date }[];
  notes: { body: string }[];
};

/**
 * Everything the model is permitted to use, and nothing else.
 *
 * Each line is a fact from a row. Nothing is summarised or inferred here —
 * inference is what the model is for, and doing it twice is how a detail that
 * traces to nothing ends up in a message.
 */
function assembleGrounding(
  lead: LeadForDraft,
  knowledge: { kind: string; title: string; body: string }[]
): GroundingSection[] {
  const company = lead.company;

  const aboutThem: string[] = [
    `Company: ${company.name}`,
    company.industry ? `Industry: ${company.industry}` : null,
    company.city ? `Location: ${company.city}` : null,
    company.employeeCount ? `Headcount: ${company.employeeCount}` : null,
    company.technologies.length ? `Technology recorded in use: ${company.technologies.join(", ")}` : null,
    `Contact: ${lead.person.fullName}${lead.person.headline ? `, ${lead.person.headline}` : ""}`,
  ].filter((l): l is string => l !== null);

  // The surfacing reason is only grounding if it is a fact about them rather
  // than a description of how they were imported.
  if (!/^(added|imported|manual)/i.test(lead.surfacedReason)) {
    aboutThem.push(`Why they surfaced: ${lead.surfacedReason}`);
  }

  return [
    {
      heading: "What you sell",
      lines: knowledge
        .filter((k) => k.kind === "service" || k.kind === "pricing")
        .map((k) => `${k.title}: ${k.body}`),
    },
    {
      heading: "Proof you can point to",
      lines: knowledge
        .filter((k) => k.kind === "case_study")
        .map((k) => `${k.title}: ${k.body}`),
    },
    {
      heading: "Objections you have heard before",
      lines: knowledge
        .filter((k) => k.kind === "objection" || k.kind === "battlecard")
        .map((k) => `${k.title}: ${k.body}`),
    },
    { heading: "About this prospect", lines: aboutThem },
    {
      heading: "Signals on record",
      lines: lead.signals.map(
        (s) => `${s.title} — ${s.excerpt} (${s.sourceName}, ${s.occurredAt.toDateString()})`
      ),
    },
    {
      heading: "What your team has written",
      lines: lead.notes.map((n) => n.body),
    },
  ];
}
