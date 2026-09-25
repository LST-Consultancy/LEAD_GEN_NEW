import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { complete } from "@/lib/ai/complete";
import { containsInventedNumber } from "@/lib/ai/verdict";
import { findMoney, findUncomputedAmount } from "@/lib/proposals/money-guard";
import { recordAudit } from "@/lib/services/audit";

/**
 * §uu — an account strategy briefing, generated on demand from the Accounts
 * screen.
 *
 * Not persisted: like `proposal_draft`, this is a draft for a person to read
 * and act on, not a system of record — the committee, deals and signals it is
 * grounded in already live in their own tables, so nothing is lost by
 * regenerating rather than storing.
 *
 * Two different guards for two different kinds of number: `findUncomputedAmount`
 * (the same one proposals use) checks any rupee figure, because a model that
 * restates ₹18,00,000 as "₹18 lakh" is still correct and must not be refused
 * for it. `containsInventedNumber` checks everything else — committee
 * influence, headcount, signal counts — after the money mentions are stripped
 * out, so the two checks cannot double-flag the same digit.
 */

export const accountPlanSchema = z.object({ companyId: z.string().uuid() });
export type AccountPlanInput = z.input<typeof accountPlanSchema>;

export type AccountPlanResult =
  | {
      ok: true;
      sections: { key: string; title: string; body: string }[];
      model: string;
      costInr: number;
    }
  | { ok: false; code: AccountPlanFailure; reason: string };

export type AccountPlanFailure =
  | "not_found"
  | "no_committee_or_deal"
  | "provider_unavailable"
  | "unusable_output"
  | "invented_number";

const SYSTEM = `You write a short account strategy briefing for a B2B salesperson,
from real data about one company: its mapped buying committee, open deals,
recent signals and technology stack. Every fact is already computed and given
to you; you are writing the "so what", not discovering anything new.

Hard rules:
- Never state a rupee amount that is not one of the amounts given to you.
  Refer to a deal by name or in words ("the larger open deal") rather than
  restating a figure you are unsure of.
- Never state a score, percentage or count of your own — reference committee
  members by name and role, not by an influence number; describe counts in
  words ("three stakeholders"), not as a statistic you computed.
- If no decision maker or champion is mapped, say so as a risk — it is the
  single most common reason a deal stalls.
- If the committee has one contact only, name that as a risk explicitly.
- Base the plan only on what is given. Do not assume a budget, a timeline or
  a competitor that is not in the data.
- Plain Indian English. No preamble, no "Based on the data provided".

Return strict JSON and nothing else, with exactly these keys in this order:
{"sections": [
  {"key": "stakeholders", "title": string, "body": string},
  {"key": "strategy", "title": string, "body": string},
  {"key": "risks", "title": string, "body": string}
]}`;

export async function generateAccountPlan(
  ctx: AuthContext,
  raw: AccountPlanInput
): Promise<AccountPlanResult> {
  const input = accountPlanSchema.parse(raw);
  const visible = leadVisibilityFilter(ctx);

  const company = await db.company.findFirst({
    where: { id: input.companyId, workspaceId: ctx.workspaceId, deletedAt: null },
    include: {
      committee: {
        where: { removedAt: null },
        orderBy: { influence: "desc" },
        select: {
          role: true,
          influence: true,
          sentiment: true,
          confirmedAt: true,
          person: { select: { fullName: true } },
        },
      },
      leads: {
        where: { deletedAt: null, ...visible },
        select: { tier: true, intent: true, person: { select: { fullName: true } } },
      },
      deals: {
        where: { deletedAt: null, status: "OPEN" },
        select: { title: true, valueInr: true, stage: { select: { name: true } } },
      },
      signals: {
        orderBy: { occurredAt: "desc" },
        take: 5,
        select: { title: true, type: true, occurredAt: true },
      },
    },
  });

  if (!company) {
    return {
      ok: false,
      code: "not_found",
      reason: "That account doesn't exist, or you don't have access to it.",
    };
  }

  if (company.committee.length === 0 && company.deals.length === 0) {
    return {
      ok: false,
      code: "no_committee_or_deal",
      reason:
        "Nobody is mapped on the buying committee and there is no open deal, so there is nothing to plan around yet. Map at least one stakeholder first.",
    };
  }

  const dealAmounts = company.deals.map((d) => Number(d.valueInr));
  const influenceScores = company.committee.map((m) => m.influence);

  const prompt = [
    `ACCOUNT: ${company.name}${company.industry ? `, ${company.industry}` : ""}${
      company.employeeCount ? `, ${company.employeeCount} people` : ""
    }`,
    company.technologies.length ? `RUNS: ${company.technologies.join(", ")}` : "",
    "",
    "BUYING COMMITTEE (already mapped — do not restate influence numbers):",
    ...(company.committee.length
      ? company.committee.map(
          (m) =>
            `- ${m.person.fullName}, ${m.role}${m.confirmedAt ? " (confirmed)" : " (inferred, unconfirmed)"}${m.sentiment ? `, sentiment ${m.sentiment}` : ""}`
        )
      : ["- Nobody mapped yet."]),
    "",
    "OPEN DEALS (already priced — do not restate the amounts except by name):",
    ...(company.deals.length
      ? company.deals.map((d) => `- ${d.title}: ${d.stage.name}`)
      : ["- None open."]),
    "",
    "LEADS AT THIS ACCOUNT:",
    ...(company.leads.length
      ? company.leads.map((l) => `- ${l.person.fullName}, tier ${l.tier}, intent ${l.intent}`)
      : ["- None."]),
    "",
    "RECENT SIGNALS:",
    ...(company.signals.length
      ? company.signals.map((s) => `- [${s.type}] ${s.title} (${s.occurredAt.toDateString()})`)
      : ["- None recorded."]),
    "",
    "Write the account plan.",
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await complete(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    { feature: "account_plan", system: SYSTEM, prompt, maxTokens: 2000, timeoutMs: 45_000 }
  );

  if (!completion.ok) {
    return { ok: false, code: "provider_unavailable", reason: completion.reason };
  }

  const parsed = parseSections(completion.text);
  if (!parsed) {
    return {
      ok: false,
      code: "unusable_output",
      reason: "The model returned something that wasn't a usable plan. Nothing was recorded — try again.",
    };
  }

  for (const section of parsed) {
    const text = `${section.title}\n${section.body}`;

    const invalidMoney = findUncomputedAmount(text, dealAmounts);
    if (invalidMoney) {
      return {
        ok: false,
        code: "invented_number",
        reason: `The plan stated ${invalidMoney.raw} in "${section.title}", which is not one of this account's deal amounts.`,
      };
    }

    // Strip the money mentions the check above already cleared, so a rupee
    // figure like "18" inside "₹18 lakh" is not re-checked as a bare number
    // and refused for not matching an unrelated allowed count.
    const withoutMoney = findMoney(text).reduce((t, m) => t.replace(m.raw, ""), text);
    const invalidNumber = containsInventedNumber(withoutMoney, [
      company.employeeCount ?? Number.NaN,
      company.leads.length,
      company.signals.length,
      company.committee.length,
      ...influenceScores,
    ]);
    if (invalidNumber !== null) {
      return {
        ok: false,
        code: "invented_number",
        reason: `The plan stated a figure (${invalidNumber}) in "${section.title}" that wasn't one of the computed ones.`,
      };
    }
  }

  await recordAudit(ctx, {
    action: "account.plan_generated",
    objectType: "Company",
    objectId: company.id,
    after: { model: completion.model, sections: parsed.map((s) => s.key) },
    actorType: "HUMAN",
  });

  return { ok: true, sections: parsed, model: completion.model, costInr: completion.estimatedCostInr };
}

type Section = { key: string; title: string; body: string };

export function parseSections(raw: string): Section[] | null {
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

  return sections.length > 0 ? sections : null;
}
