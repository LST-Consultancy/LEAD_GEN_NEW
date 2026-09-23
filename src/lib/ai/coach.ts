import "server-only";
import { db } from "@/lib/db";
import { complete } from "@/lib/ai/complete";
import { containsInventedNumber } from "@/lib/ai/verdict";

/**
 * §13 — the Today screen's sales coach.
 *
 * `AiSalesCoach` has read from `AIInsight` (kind `COACH_TIP`) since the Today
 * screen shipped, but nothing ever wrote one, so the panel always rendered its
 * empty state. This is what writes it.
 *
 * The panel's own copy sets the bar: "compares your sent messages against
 * replies received" — one specific, data-derived recommendation, never a
 * platitude. So the comparison itself is computed here, in code, from real
 * `Message` rows; the model is only asked to phrase the one comparison this
 * function already picked. `containsInventedNumber` — the same guard
 * `lead_verdict` uses — refuses a reply that states any figure beyond the ones
 * it was given.
 */

const DAY = 86_400_000;
/** Recent enough that the pattern still describes how this rep works now. */
const LOOKBACK_DAYS = 60;
/** A reply arriving later than this is credited to something else that happened in between. */
const REPLY_WINDOW_DAYS = 14;
/** Below this per side, a gap is noise, not a pattern. */
export const MIN_SAMPLE_PER_GROUP = 6;
/** Below this many percentage points, the gap isn't worth a rep's attention. */
export const MIN_GAP_POINTS = 15;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type CoachTipResult =
  | { ok: true; created: true; insightId: string }
  | { ok: true; created: false; reason: "insufficient_data" }
  | { ok: false; code: "provider_unavailable" | "invented_number"; reason: string };

type Group = { label: string; href: string; replied: number; total: number };

type Candidate = {
  best: Group;
  worst: Group;
  gapPoints: number;
  factLine: string;
  allowedNumbers: number[];
};

const SYSTEM = `You write one coaching observation for a B2B salesperson, from one
comparison already computed from their own sent messages and the replies they
got back. The comparison is decided; you only phrase it.

Hard rules:
- Never state a number that is not given to you. Do not compute a new
  percentage, average, gap or count of your own.
- Do not claim more certainty than a sample this size supports — "tend to",
  not "always". Do not invent a reason the pattern exists; describe it and
  suggest testing it, not explaining it.
- One concrete recommendation the rep can act on this week.
- Two to three sentences for the body. One short sentence for "why now" that
  mentions the sample the comparison is based on.
- Plain Indian English. No preamble, no "Based on the data provided".

Return strict JSON and nothing else:
{"title": string, "body": string, "whyNow": string}`;

/**
 * Every outbound message this rep actually sent in the lookback window, with
 * whether a reply followed it within the attribution window — computed once,
 * in code, so every comparison below reads from the same facts.
 */
async function loadAttributedSends(workspaceId: string, userId: string) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY);

  const sent = await db.message.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      direction: "OUTBOUND",
      actorUserId: userId,
      state: { in: ["SENT", "DELIVERED", "READ", "REPLIED"] },
      sentAt: { gte: since },
    },
    select: {
      conversationId: true,
      sentAt: true,
      sequenceStep: { select: { stepOrder: true } },
    },
  });

  const conversationIds = [...new Set(sent.map((m) => m.conversationId))];
  const inbound = conversationIds.length
    ? await db.message.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          direction: "INBOUND",
          conversationId: { in: conversationIds },
        },
        select: { conversationId: true, createdAt: true },
      })
    : [];

  const inboundByConversation = new Map<string, number[]>();
  for (const m of inbound) {
    const list = inboundByConversation.get(m.conversationId) ?? [];
    list.push(m.createdAt.getTime());
    inboundByConversation.set(m.conversationId, list);
  }

  return sent.map((m) => {
    const sentAt = m.sentAt as Date;
    const replies = inboundByConversation.get(m.conversationId) ?? [];
    const gotReply = replies.some(
      (t) => t > sentAt.getTime() && t <= sentAt.getTime() + REPLY_WINDOW_DAYS * DAY
    );
    return { sentAt, stepOrder: m.sequenceStep?.stepOrder ?? 1, gotReply };
  });
}

export function rate(replied: number, total: number): number {
  return Math.round((replied / total) * 100);
}

/** Best vs worst weekday for getting a reply, among weekdays with enough sends. */
export function byWeekday(sends: { sentAt: Date; gotReply: boolean }[]): Candidate | null {
  const buckets = new Map<number, { replied: number; total: number }>();
  for (const s of sends) {
    // Intl rather than `Date#getDay`, so the bucket reflects the workspace's
    // own calendar day rather than wherever this process happens to run.
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "Asia/Kolkata" }).format(
      s.sentAt
    );
    const index = WEEKDAY_NAMES.indexOf(weekday);
    const b = buckets.get(index) ?? { replied: 0, total: 0 };
    b.total += 1;
    if (s.gotReply) b.replied += 1;
    buckets.set(index, b);
  }

  const qualifying = [...buckets.entries()]
    .filter(([, b]) => b.total >= MIN_SAMPLE_PER_GROUP)
    .map(([day, b]) => ({
      label: WEEKDAY_NAMES[day],
      href: "/inbox",
      replied: b.replied,
      total: b.total,
    }));

  if (qualifying.length < 2) return null;

  const ranked = qualifying.sort((a, b) => rate(b.replied, b.total) - rate(a.replied, a.total));
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const bestPct = rate(best.replied, best.total);
  const worstPct = rate(worst.replied, worst.total);
  const gapPoints = bestPct - worstPct;
  if (gapPoints < MIN_GAP_POINTS) return null;

  const totalSends = best.total + worst.total;
  return {
    best,
    worst,
    gapPoints,
    factLine: `Sent on ${best.label}: ${bestPct}% replied (${best.replied} of ${best.total}). Sent on ${worst.label}: ${worstPct}% replied (${worst.replied} of ${worst.total}). ${totalSends} sends total across the two days.`,
    // The total is given rather than left for the model to add up itself — a
    // sum it computes is indistinguishable from one it invents, so the guard
    // below cannot tell them apart, and would refuse a correct one on sight.
    allowedNumbers: [bestPct, worstPct, best.replied, best.total, worst.replied, worst.total, gapPoints, totalSends],
  };
}

/** First touch vs a follow-up step, for getting a reply. */
export function byTouch(sends: { stepOrder: number; gotReply: boolean }[]): Candidate | null {
  const first = { replied: 0, total: 0 };
  const followUp = { replied: 0, total: 0 };
  for (const s of sends) {
    const bucket = s.stepOrder <= 1 ? first : followUp;
    bucket.total += 1;
    if (s.gotReply) bucket.replied += 1;
  }
  if (first.total < MIN_SAMPLE_PER_GROUP || followUp.total < MIN_SAMPLE_PER_GROUP) return null;

  const firstPct = rate(first.replied, first.total);
  const followUpPct = rate(followUp.replied, followUp.total);
  const gapPoints = Math.abs(firstPct - followUpPct);
  if (gapPoints < MIN_GAP_POINTS) return null;

  const bestGroup: Group = { label: "First touch", href: "/inbox", ...first };
  const worstGroup: Group = { label: "Follow-up", href: "/inbox", ...followUp };
  const [best, worst] = firstPct >= followUpPct ? [bestGroup, worstGroup] : [worstGroup, bestGroup];
  const bestPct = firstPct >= followUpPct ? firstPct : followUpPct;
  const worstPct = firstPct >= followUpPct ? followUpPct : firstPct;

  const totalSends = best.total + worst.total;
  return {
    best,
    worst,
    gapPoints,
    factLine: `${best.label} messages: ${bestPct}% replied (${best.replied} of ${best.total}). ${worst.label} messages: ${worstPct}% replied (${worst.replied} of ${worst.total}). ${totalSends} sends total between the two.`,
    allowedNumbers: [bestPct, worstPct, best.replied, best.total, worst.replied, worst.total, gapPoints, totalSends],
  };
}

/**
 * Generates and stores one coach tip for one rep, replacing whatever tip was
 * there before — a stale recommendation should never outlive the data that
 * produced it, the same reasoning `refreshNextBestActions` uses.
 */
export async function generateCoachTip(workspaceId: string, userId: string): Promise<CoachTipResult> {
  const sends = await loadAttributedSends(workspaceId, userId);

  const candidates = [byWeekday(sends), byTouch(sends)].filter((c): c is Candidate => c !== null);
  if (candidates.length === 0) {
    return { ok: true, created: false, reason: "insufficient_data" };
  }

  // The larger gap is the more useful thing to tell this rep about right now.
  const candidate = candidates.sort((a, b) => b.gapPoints - a.gapPoints)[0];

  const prompt = [
    `COMPARISON, from this rep's own sent messages over the last ${LOOKBACK_DAYS} days:`,
    candidate.factLine,
    "",
    "Write the coaching observation.",
  ].join("\n");

  const completion = await complete(
    { workspaceId, userId },
    { feature: "coach_tip", system: SYSTEM, prompt, maxTokens: 800, timeoutMs: 30_000 }
  );

  if (!completion.ok) {
    return { ok: false, code: "provider_unavailable", reason: completion.reason };
  }

  const parsed = parseCoachTip(completion.text);
  if (!parsed) {
    return { ok: false, code: "provider_unavailable", reason: "The model returned something unusable." };
  }

  const invented = containsInventedNumber(
    `${parsed.title} ${parsed.body} ${parsed.whyNow}`,
    // The prompt states the lookback window itself, and the system prompt asks
    // for a "why now" that mentions the sample — so a correct reply legitimately
    // echoes it back. Omitting it here was refusing that correct reply.
    [...candidate.allowedNumbers, LOOKBACK_DAYS]
  );
  if (invented !== null) {
    return {
      ok: false,
      code: "invented_number",
      reason: `The coach tip stated a figure (${invented}) that wasn't one of the computed ones, so it was discarded.`,
    };
  }

  const totalSample = candidate.best.total + candidate.worst.total;
  // A confidence label, not a statistic: more sends behind the comparison
  // reads as more confidence. Stated as an assumption, not computed as one.
  const confidence = totalSample >= 40 ? 80 : totalSample >= 20 ? 70 : 60;

  const insight = await db.$transaction(async (tx) => {
    await tx.aIInsight.deleteMany({ where: { workspaceId, kind: "COACH_TIP", forUserId: userId } });
    return tx.aIInsight.create({
      data: {
        workspaceId,
        kind: "COACH_TIP",
        title: parsed.title,
        body: parsed.body,
        whyNow: parsed.whyNow,
        forUserId: userId,
        modelUsed: completion.model,
        confidence,
        evidence: [
          { label: `${candidate.best.label}: ${rate(candidate.best.replied, candidate.best.total)}% replied (${candidate.best.replied} of ${candidate.best.total})`, href: candidate.best.href },
          { label: `${candidate.worst.label}: ${rate(candidate.worst.replied, candidate.worst.total)}% replied (${candidate.worst.replied} of ${candidate.worst.total})`, href: candidate.worst.href },
        ],
      },
    });
  });

  return { ok: true, created: true, insightId: insight.id };
}

type Parsed = { title: string; body: string; whyNow: string };

export function parseCoachTip(raw: string): Parsed | null {
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
  const whyNow = String(obj.whyNow ?? "").trim();
  if (!title || !body) return null;
  return { title, body, whyNow };
}
