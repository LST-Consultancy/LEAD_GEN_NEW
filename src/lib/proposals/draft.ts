import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { complete } from "@/lib/ai/complete";
import { computeTotals } from "@/lib/proposals/money";
import { allowedAmounts, findUncomputedAmount } from "@/lib/proposals/money-guard";
import { recordAudit } from "@/lib/services/audit";

/**
 * §60 — drafting the narrative of a proposal.
 *
 * The division of labour is the whole design: **the model writes prose, the
 * line items carry every number.** Scope, approach, what happens in week one —
 * those benefit from being written well. The price does not; it is arithmetic
 * over rows, computed in integer paise by `money.ts`.
 *
 * So any monetary figure appearing in generated prose is one the model invented,
 * and `findUncomputedAmount` refuses the draft rather than showing it with a
 * warning somebody scrolls past. A wrong figure in an email is embarrassing; a
 * wrong figure in a proposal is something a customer accepts and holds you to.
 *
 * This drafts into an *existing* proposal's sections. It never creates one, and
 * never touches `items`, `taxRate` or the stored totals.
 */

export const proposalDraftSchema = z.object({
  proposalId: z.string().uuid(),
  /** What the seller wants emphasised. The grounding still binds it. */
  angle: z.string().trim().max(200).optional(),
});

export type ProposalDraftInput = z.input<typeof proposalDraftSchema>;

export type ProposalDraftResult =
  | {
      ok: true;
      sections: { key: string; title: string; body: string }[];
      /** Reported so the screen can show what the prose was allowed to cite. */
      totals: { subtotalInr: number; taxInr: number; totalInr: number };
      withheld: string | null;
      model: string;
      costInr: number;
    }
  | { ok: false; code: ProposalDraftFailure; reason: string };

export type ProposalDraftFailure =
  | "not_found"
  | "no_items"
  | "already_sent"
  | "no_grounding"
  | "provider_unavailable"
  | "unusable_output"
  | "invented_amount";

const SYSTEM = `You write the narrative sections of a B2B proposal for an Indian
services company.

You are given the priced line items and the computed totals. They are already
decided.

Hard rules:
- **Never write a price, a total, a discount or any monetary figure.** Refer to
  the commercial terms in words — "the fees set out below", "the phase one
  amount". Every number the customer sees comes from the line items table,
  which is rendered separately. A figure you write that disagrees with it is a
  commitment someone has to honour.
- Never promise a timeline, a headcount or an outcome that is not in the
  grounding. If the knowledge base does not say it, this company does not
  offer it.
- Write for the person who has to get this approved internally. They need scope
  they can defend, not adjectives.
- No filler: no "we are delighted", no "industry-leading", no restating the
  client's own business back to them.
- Indian English.

Return strict JSON and nothing else:
{"sections": [{"key": string, "title": string, "body": string}], "withheld": string | null}

Use exactly these keys, in this order: "summary", "scope", "approach",
"assumptions". "withheld" names anything you could not say for lack of
grounding, or is null.`;

export async function draftProposalNarrative(
  ctx: AuthContext,
  raw: ProposalDraftInput
): Promise<ProposalDraftResult> {
  const input = proposalDraftSchema.parse(raw);

  const proposal = await db.proposal.findFirst({
    where: {
      id: input.proposalId,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      OR: [{ leadId: null }, { lead: { deletedAt: null, ...leadVisibilityFilter(ctx) } }],
    },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      company: { select: { name: true, industry: true, employeeCount: true, city: true } },
      lead: { select: { surfacedReason: true, person: { select: { fullName: true, headline: true } } } },
    },
  });

  if (!proposal) {
    return {
      ok: false,
      code: "not_found",
      reason: "That proposal doesn't exist, or you don't have access to it.",
    };
  }

  // Drafting into something a customer has already seen would change a
  // document under them. Editing a sent proposal is a deliberate act elsewhere.
  if (proposal.sentAt) {
    return {
      ok: false,
      code: "already_sent",
      reason:
        "This proposal has already been sent, so its narrative is not redrafted automatically. The customer may have read it; changing it under them is a decision, not a generation.",
    };
  }

  if (proposal.items.length === 0) {
    return {
      ok: false,
      code: "no_items",
      reason:
        "This proposal has no line items yet. The narrative is written around what is being sold, so price it first — otherwise the draft would have to invent the scope.",
    };
  }

  const knowledge = await db.knowledgeDoc.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      isActive: true,
      kind: { in: ["service", "case_study", "pricing"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { kind: true, title: true, body: true },
  });

  if (knowledge.length === 0) {
    return {
      ok: false,
      code: "no_grounding",
      reason:
        "Nothing is written in the Knowledge Base, so the draft would have to invent what you deliver. Add one service entry first — that entry is what keeps a proposal's scope honest.",
    };
  }

  const items = proposal.items.map((i) => ({
    name: i.name,
    description: i.description,
    quantity: Number(i.quantity),
    unit: i.unit,
    unitPriceInr: Number(i.unitPriceInr),
    amountInr: Number(i.amountInr),
  }));

  // Recomputed rather than read: the stored totals are what the guard compares
  // against, and a stored figure that has drifted from its items would let a
  // drifted number through as "computed".
  const totals = computeTotals(
    items.map((i) => ({ name: i.name, quantity: i.quantity, unitPriceInr: i.unitPriceInr })),
    Number(proposal.taxRate)
  );

  const prompt = [
    `CLIENT: ${proposal.company.name}${proposal.company.industry ? `, ${proposal.company.industry}` : ""}${
      proposal.company.employeeCount ? `, ${proposal.company.employeeCount} people` : ""
    }`,
    proposal.lead
      ? `CONTACT: ${proposal.lead.person.fullName}${proposal.lead.person.headline ? `, ${proposal.lead.person.headline}` : ""}`
      : "",
    proposal.lead?.surfacedReason ? `WHY THEY SURFACED: ${proposal.lead.surfacedReason}` : "",
    `PROPOSAL TITLE: ${proposal.title}`,
    "",
    "LINE ITEMS (already priced — do not restate any amount):",
    ...items.map(
      (i) => `- ${i.name}${i.description ? ` — ${i.description}` : ""} (${i.quantity} ${i.unit})`
    ),
    "",
    "WHAT THIS COMPANY ACTUALLY SELLS:",
    ...knowledge.map((k) => `- [${k.kind}] ${k.title}: ${k.body}`),
    "",
    input.angle ? `ANGLE THE SELLER ASKED FOR: ${input.angle}` : "",
    "",
    "Write the narrative sections.",
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await complete(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    { feature: "proposal_draft", system: SYSTEM, prompt, maxTokens: 4000, timeoutMs: 60_000 }
  );

  if (!completion.ok) {
    return { ok: false, code: "provider_unavailable", reason: completion.reason };
  }

  const parsed = parseSections(completion.text);
  if (!parsed) {
    return {
      ok: false,
      code: "unusable_output",
      reason:
        "The model returned something that wasn't a usable set of sections. Nothing was saved — try again, or write the scope yourself.",
    };
  }

  // The guarantee. Checked across every section, not just the summary.
  const allowed = allowedAmounts({ items, ...totals });
  for (const section of parsed.sections) {
    const invented = findUncomputedAmount(`${section.title}\n${section.body}`, allowed);
    if (invented) {
      return {
        ok: false,
        code: "invented_amount",
        reason: `The draft stated ${invented.raw} in "${section.title}", which is not one of the priced amounts. Nothing was saved. The line items and totals are unchanged — they are computed, not generated.`,
      };
    }
  }

  await recordAudit(ctx, {
    action: "proposal.drafted",
    objectType: "Proposal",
    objectId: proposal.id,
    after: {
      model: completion.model,
      sections: parsed.sections.map((s) => s.key),
      withheld: parsed.withheld,
    },
    actorType: "HUMAN",
  });

  return {
    ok: true,
    sections: parsed.sections,
    totals: {
      subtotalInr: totals.subtotalInr,
      taxInr: totals.taxInr,
      totalInr: totals.totalInr,
    },
    withheld: parsed.withheld,
    model: completion.model,
    costInr: completion.estimatedCostInr,
  };
}

type Parsed = { sections: { key: string; title: string; body: string }[]; withheld: string | null };

/** Tolerant of a fenced block, for the same reason the outreach parser is. */
export function parseSections(raw: string): Parsed | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.sections)) return null;

  const sections = obj.sections
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({
      key: String(s.key ?? "").trim(),
      title: String(s.title ?? "").trim(),
      body: String(s.body ?? "").trim(),
    }))
    .filter((s) => s.key && s.title && s.body);

  if (sections.length === 0) return null;

  return {
    sections,
    withheld:
      typeof obj.withheld === "string" && obj.withheld.trim() ? obj.withheld.trim() : null,
  };
}
