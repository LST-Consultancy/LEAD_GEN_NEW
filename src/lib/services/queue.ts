import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { toPlain } from "@/lib/serialize";

const LANES = ["QUEUED", "WORKING", "NEEDS_ATTENTION", "DONE"] as const;

/**
 * §38 — the personal execution queue. Ordering is by impact score, so the tab
 * a user opens first already shows what matters most rather than what is oldest.
 */
export async function getMyQueue(ctx: AuthContext) {
  const tasks = await db.task.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      OR: [{ ownerId: ctx.userId }, { assignments: { some: { userId: ctx.userId } } }],
    },
    orderBy: [{ priorityScore: "desc" }, { dueAt: "asc" }],
    include: {
      lead: {
        select: {
          id: true,
          tier: true,
          intent: true,
          repliedAt: true,
          person: { select: { fullName: true, avatarUrl: true } },
          company: { select: { id: true, name: true } },
          score: { select: { displayScore: true } },
          signals: {
            take: 1,
            orderBy: { occurredAt: "desc" },
            select: { title: true, excerpt: true, occurredAt: true, type: true },
          },
          conversations: {
            take: 1,
            orderBy: { lastMessageAt: "desc" },
            select: {
              aiSummary: true,
              messages: {
                take: 2,
                orderBy: { createdAt: "desc" },
                select: { direction: true, body: true, createdAt: true },
              },
            },
          },
        },
      },
      deal: {
        select: {
          id: true,
          title: true,
          valueInr: true,
          stage: { select: { name: true } },
          risks: { where: { resolvedAt: null }, select: { title: true, explanation: true } },
        },
      },
      owner: { select: { id: true, name: true, avatarUrl: true } },
      assignments: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
    },
  });

  const mapped = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    priorityScore: t.priorityScore,
    priorityReason: t.priorityReason,
    recommendedAction: t.recommendedAction,
    expectedImpactInr: t.expectedImpactInr,
    revenueImpact: t.revenueImpact,
    channel: t.channel,
    dueAt: t.dueAt,
    completedAt: t.completedAt,
    isOverdue: t.dueAt ? t.dueAt < new Date() && t.status !== "DONE" : false,
    createdByAi: t.createdByAi,
    lane: t.status === "DONE" ? "DONE" : t.lane,
    owner: t.owner,
    collaborators: t.assignments.map((a) => a.user),
    lead: t.lead
      ? {
          id: t.lead.id,
          name: t.lead.person.fullName,
          avatarUrl: t.lead.person.avatarUrl,
          company: t.lead.company.name,
          companyId: t.lead.company.id,
          tier: t.lead.tier,
          intent: t.lead.intent,
          score: t.lead.score ? Number(t.lead.score.displayScore) : null,
          hasReplied: t.lead.repliedAt !== null,
          latestSignal: t.lead.signals[0] ?? null,
          conversation: t.lead.conversations[0] ?? null,
        }
      : null,
    deal: t.deal
      ? {
          id: t.deal.id,
          title: t.deal.title,
          valueInr: t.deal.valueInr,
          stage: t.deal.stage.name,
          risks: t.deal.risks,
        }
      : null,
  }));

  const byLane = Object.fromEntries(
    LANES.map((lane) => [
      lane,
      mapped.filter((t) =>
        lane === "DONE" ? t.status === "DONE" : t.status !== "DONE" && t.lane === lane
      ),
    ])
  ) as Record<(typeof LANES)[number], typeof mapped>;

  const active = mapped.filter((t) => t.status !== "DONE");

  return toPlain({
    lanes: byLane,
    counts: {
      QUEUED: byLane.QUEUED.length,
      WORKING: byLane.WORKING.length,
      NEEDS_ATTENTION: byLane.NEEDS_ATTENTION.length,
      DONE: byLane.DONE.length,
    },
    summary: {
      activeCount: active.length,
      overdueCount: active.filter((t) => t.isOverdue).length,
      totalImpactInr: active.reduce((s, t) => s + Number(t.expectedImpactInr ?? 0), 0),
      completedToday: mapped.filter(
        (t) =>
          t.completedAt &&
          new Date(t.completedAt).toDateString() === new Date().toDateString()
      ).length,
    },
    /** What Focus Mode opens on: the highest-impact item that isn't blocked. */
    focusOrder: active.map((t) => t.id),
  });
}
