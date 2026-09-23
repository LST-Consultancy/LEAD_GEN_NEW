import "server-only";
import { db } from "@/lib/db";
import { complete } from "@/lib/ai/complete";
import { containsInventedNumber } from "@/lib/ai/verdict";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * §6 — the Today screen's AI daily brief.
 *
 * `CopilotBrief` already renders "since yesterday" as counted facts, each
 * linking to the query that produced it, and is deliberately *not* generated
 * prose — see its own comment. This is the complement, not a replacement: a
 * short synthesis of which one of those facts to act on first, in the model's
 * own words. It is given the same counts the brief already shows and nothing
 * else, so it cannot introduce a fact the rep couldn't already see; the
 * guard is the same one `lead_verdict` and `coach_tip` use.
 *
 * Skipped entirely on a quiet day: if nothing changed, there is nothing to
 * prioritise, and a generated sentence about an empty day is exactly the
 * "generic advice" the product avoids.
 */

const DAY = 86_400_000;

export type DailyBriefResult =
  | { ok: true; created: true; insightId: string }
  | { ok: true; created: false; reason: "nothing_changed" }
  | { ok: false; code: "provider_unavailable" | "invented_number"; reason: string };

type Fact = { label: string; count: number; href: string };

const SYSTEM = `You write one short "start here" recommendation for a B2B
salesperson, from a list of counted facts about what changed in their
workspace since yesterday. The facts are already computed and already shown
to them individually; your job is to say which one to act on first, and why.

Hard rules:
- Never state a number that is not in the list you are given. Do not add,
  average, or estimate a count of your own.
- Recommend exactly one thing to do first. If several facts compete, pick the
  one most likely to cost a deal if it waits — a reply waiting outranks a new
  signal, which outranks a follow-up that is merely due.
- Two sentences at most.
- Plain Indian English. No preamble, no "Based on the data provided".

Return strict JSON and nothing else:
{"title": string, "body": string}`;

/**
 * The same visibility rule `getChangesSinceYesterday` applies for a signed-in
 * viewer, reproduced here because a background job has no session — only a
 * workspace and a member to compute for.
 */
async function ownerScopeFor(workspaceId: string, userId: string): Promise<{ ownerId?: string }> {
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId, deletedAt: null },
    select: { role: { select: { permissions: true } } },
  });
  const viewAll = member?.role.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL) ?? false;
  return viewAll ? {} : { ownerId: userId };
}

async function loadFacts(workspaceId: string, userId: string): Promise<Fact[]> {
  const since = new Date(Date.now() - DAY);
  const scope = await ownerScopeFor(workspaceId, userId);

  const [intentRisers, repliesNeedingYou, stalledDeals, dueFollowUps, proposalViews, meetingsToday] =
    await Promise.all([
      db.lead.count({
        where: {
          workspaceId,
          deletedAt: null,
          archivedAt: null,
          ...scope,
          tier: { in: ["A", "B"] },
          intent: { in: ["HOT", "BUYING"] },
          signals: { some: { detectedAt: { gte: since } } },
        },
      }),
      db.conversation.count({
        where: {
          workspaceId,
          deletedAt: null,
          state: "NEEDS_YOU",
          ...(scope.ownerId ? { assigneeId: scope.ownerId } : {}),
        },
      }),
      db.deal.count({
        where: {
          workspaceId,
          deletedAt: null,
          status: "OPEN",
          ...(scope.ownerId ? { ownerId: scope.ownerId } : {}),
          risks: { some: { resolvedAt: null, code: { in: ["stage_stalled", "inactive"] } } },
        },
      }),
      db.task.count({
        where: {
          workspaceId,
          deletedAt: null,
          ownerId: userId,
          status: { in: ["QUEUED", "WORKING", "NEEDS_ATTENTION"] },
          dueAt: { lte: new Date(Date.now() + DAY) },
        },
      }),
      db.proposalView.count({ where: { workspaceId, viewedAt: { gte: since } } }),
      db.booking.count({
        where: {
          workspaceId,
          deletedAt: null,
          startsAt: { gte: new Date(), lte: new Date(Date.now() + DAY) },
          ...(scope.ownerId ? { hostUserId: scope.ownerId } : {}),
        },
      }),
    ]);

  const facts: Fact[] = [];
  if (repliesNeedingYou > 0) facts.push({ label: "Replies needing a response", count: repliesNeedingYou, href: "/inbox" });
  if (intentRisers > 0) facts.push({ label: "Top-tier leads showing stronger intent", count: intentRisers, href: "/leads?shortcut=hot-intent" });
  if (stalledDeals > 0) facts.push({ label: "Deals stalled", count: stalledDeals, href: "/pipeline" });
  if (dueFollowUps > 0) facts.push({ label: "Follow-ups due", count: dueFollowUps, href: "/my-queue" });
  if (proposalViews > 0) facts.push({ label: "Proposal views", count: proposalViews, href: "/proposals" });
  if (meetingsToday > 0) facts.push({ label: "Meetings in the next 24 hours", count: meetingsToday, href: "/bookings" });
  return facts;
}

export async function generateDailyBrief(workspaceId: string, userId: string): Promise<DailyBriefResult> {
  const facts = await loadFacts(workspaceId, userId);
  if (facts.length === 0) {
    return { ok: true, created: false, reason: "nothing_changed" };
  }

  const prompt = [
    "FACTS, since yesterday:",
    ...facts.map((f) => `- ${f.label}: ${f.count}`),
    "",
    "Write the recommendation.",
  ].join("\n");

  const completion = await complete(
    { workspaceId, userId },
    { feature: "daily_brief", system: SYSTEM, prompt, maxTokens: 500, timeoutMs: 30_000 }
  );

  if (!completion.ok) {
    return { ok: false, code: "provider_unavailable", reason: completion.reason };
  }

  const parsed = parseBrief(completion.text);
  if (!parsed) {
    return { ok: false, code: "provider_unavailable", reason: "The model returned something unusable." };
  }

  const invented = containsInventedNumber(
    `${parsed.title} ${parsed.body}`,
    facts.map((f) => f.count)
  );
  if (invented !== null) {
    return {
      ok: false,
      code: "invented_number",
      reason: `The brief stated a figure (${invented}) that wasn't one of the counted facts, so it was discarded.`,
    };
  }

  const insight = await db.$transaction(async (tx) => {
    await tx.aIInsight.deleteMany({ where: { workspaceId, kind: "DAILY_BRIEF", forUserId: userId } });
    return tx.aIInsight.create({
      data: {
        workspaceId,
        kind: "DAILY_BRIEF",
        title: parsed.title,
        body: parsed.body,
        forUserId: userId,
        modelUsed: completion.model,
        confidence: 70,
        evidence: facts.map((f) => ({ label: `${f.label}: ${f.count}`, href: f.href })),
      },
    });
  });

  return { ok: true, created: true, insightId: insight.id };
}

type Parsed = { title: string; body: string };

export function parseBrief(raw: string): Parsed | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const title = String(obj.title ?? "").trim();
  const body = String(obj.body ?? "").trim();
  if (!title || !body) return null;
  return { title, body };
}
