import "server-only";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { complete } from "@/lib/ai/complete";
import { DIMENSION_LABELS } from "@/lib/scoring";

/**
 * §71 / §72 — explaining a lead's score.
 *
 * **The model never produces a score.** `lib/scoring.ts` is pure and
 * deterministic; this reads the numbers it computed and the evidence rows
 * behind them, and asks only for a sentence that makes them legible. That
 * distinction is the whole reason this feature is safe to ship: a generated
 * number nobody can trace is exactly what eight separate dimensions exist to
 * avoid.
 *
 * Enforced rather than requested. `containsInventedNumber()` re-reads the reply
 * and refuses it if it states a figure that is not one of the computed ones —
 * a prompt instruction alone would be a hope, not a guarantee.
 */

export type VerdictResult =
  | {
      ok: true;
      text: string;
      /** The numbers the model was given, so the screen can show them beside it. */
      dimensions: { key: string; label: string; question: string; score: number }[];
      displayScore: number;
      model: string;
      costInr: number;
    }
  | { ok: false; code: VerdictFailure; reason: string };

export type VerdictFailure = "lead_not_found" | "not_scored" | "provider_unavailable" | "invented_number";

const SYSTEM = `You explain a B2B lead's score to the salesperson who owns it.

The scores are already computed, deterministically, from the evidence you are
shown. Your job is to make them legible — never to revise them.

Hard rules:
- Never state a number that is not one of the scores or counts given to you.
  Do not average, re-weight, estimate, round differently, or invent a
  percentage. If you want to compare dimensions, do it in words.
- Never contradict a score. If Authority is low, the lead's authority is low,
  whatever the job title suggests to you.
- Lead with the single dimension that most explains the overall number, then
  the one most worth fixing. Say what action would change it.
- Three sentences at most. This is read between calls.
- Plain Indian English. No preamble, no "Based on the data provided".`;

export async function explainVerdict(ctx: AuthContext, leadId: string): Promise<VerdictResult> {
  const lead = await db.lead.findFirst({
    where: { id: leadId, workspaceId: ctx.workspaceId, deletedAt: null, ...leadVisibilityFilter(ctx) },
    include: {
      company: { select: { name: true, industry: true, employeeCount: true } },
      person: { select: { fullName: true, headline: true } },
      score: { include: { evidence: { orderBy: { points: "desc" }, take: 20 } } },
    },
  });

  if (!lead) {
    return {
      ok: false,
      code: "lead_not_found",
      reason: "That lead doesn't exist, or you don't have access to it.",
    };
  }
  if (!lead.score) {
    return {
      ok: false,
      code: "not_scored",
      reason:
        "This lead hasn't been scored yet, so there is nothing to explain. A rescore runs automatically; you can also trigger one from the lead.",
    };
  }

  const s = lead.score;
  const dimensions = [
    { key: "fit", score: s.fitScore },
    { key: "intent", score: s.intentScore },
    { key: "urgency", score: s.urgencyScore },
    { key: "authority", score: s.authorityScore },
    { key: "budget", score: s.budgetScore },
    { key: "reachability", score: s.reachabilityScore },
    { key: "engagement", score: s.engagementScore },
    { key: "recency", score: s.recencyScore },
  ].map((d) => ({
    ...d,
    label: DIMENSION_LABELS[d.key as keyof typeof DIMENSION_LABELS].label,
    question: DIMENSION_LABELS[d.key as keyof typeof DIMENSION_LABELS].question,
  }));

  const displayScore = Number(s.overriddenScore ?? s.displayScore);

  const prompt = [
    `LEAD: ${lead.person.fullName}${lead.person.headline ? `, ${lead.person.headline}` : ""} at ${lead.company.name}`,
    lead.company.industry ? `INDUSTRY: ${lead.company.industry}` : "",
    lead.company.employeeCount ? `HEADCOUNT: ${lead.company.employeeCount}` : "",
    "",
    `OVERALL SCORE: ${displayScore.toFixed(1)} out of 10 (composite ${s.composite} out of 100)`,
    s.overriddenScore != null
      ? `NOTE: a person overrode this score${s.overrideReason ? ` — "${s.overrideReason}"` : ""}.`
      : "",
    "",
    "DIMENSIONS, each out of 100:",
    ...dimensions.map((d) => `- ${d.label} (${d.question}) = ${d.score}`),
    "",
    "EVIDENCE the scorer actually used:",
    ...(s.evidence.length
      ? s.evidence.map(
          (e) => `- [${e.dimension}] ${e.label}${e.detail ? `: ${e.detail}` : ""} (${e.points >= 0 ? "+" : ""}${e.points})`
        )
      : ["- (no evidence rows were recorded for this score)"]),
    "",
    "Explain it.",
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await complete(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    { feature: "lead_verdict", system: SYSTEM, prompt, maxTokens: 1500, timeoutMs: 30_000 }
  );

  if (!completion.ok) {
    return { ok: false, code: "provider_unavailable", reason: completion.reason };
  }

  // The guarantee, checked rather than trusted.
  const invented = containsInventedNumber(completion.text, [
    ...dimensions.map((d) => d.score),
    s.composite,
    displayScore,
    ...s.evidence.map((e) => Math.abs(e.points)),
    lead.company.employeeCount ?? Number.NaN,
  ]);

  if (invented !== null) {
    return {
      ok: false,
      code: "invented_number",
      reason: `The explanation stated a figure (${invented}) that isn't one of the computed scores, so it was discarded rather than shown. The scores themselves are unaffected — they are computed, not generated.`,
    };
  }

  return {
    ok: true,
    text: completion.text.trim(),
    dimensions,
    displayScore,
    model: completion.model,
    costInr: completion.estimatedCostInr,
  };
}

/**
 * Finds a number in the text that was not among those supplied.
 *
 * Returns the first offender, or null when every figure traces to a computed
 * one. Deliberately tolerant in two ways, because a false positive here throws
 * away a correct explanation:
 *
 *  - Small integers up to ten are ignored: "three dimensions", "the top two".
 *  - A number written as a word is ignored; the rule is about *figures*
 *    presented as data.
 */
export function containsInventedNumber(text: string, allowed: number[]): string | null {
  const permitted = new Set<string>();
  for (const value of allowed) {
    if (!Number.isFinite(value)) continue;
    permitted.add(String(value));
    permitted.add(value.toFixed(1));
    permitted.add(String(Math.round(value)));
  }

  for (const match of text.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    const raw = match[0];
    const value = Number(raw);
    // Counting words rather than data.
    if (Number.isInteger(value) && value <= 10) continue;
    if (permitted.has(raw) || permitted.has(String(value)) || permitted.has(value.toFixed(1))) {
      continue;
    }
    return raw;
  }
  return null;
}
