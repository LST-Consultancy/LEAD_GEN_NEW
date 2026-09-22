import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { getUsageProjection } from "@/lib/services/points";

/**
 * Sidebar and topbar counters. One batched round-trip so the shell never
 * becomes the slowest thing on the page.
 */
export async function getShellData(ctx: AuthContext) {
  const visibility = leadVisibilityFilter(ctx);

  const [inbox, queue, approvals, notifications, subscription, projection] = await Promise.all([
    db.conversation.count({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        isUnread: true,
        ...(visibility.ownerId ? { assigneeId: visibility.ownerId } : {}),
      },
    }),
    db.task.count({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        ownerId: ctx.userId,
        status: { in: ["QUEUED", "WORKING", "NEEDS_ATTENTION"] },
      },
    }),
    db.agentAction.count({
      where: { workspaceId: ctx.workspaceId, requiresApproval: true, state: "pending_approval" },
    }),
    db.notification.count({
      where: { workspaceId: ctx.workspaceId, userId: ctx.userId, readAt: null },
    }),
    db.subscription.findUnique({
      where: { workspaceId: ctx.workspaceId },
      select: { plan: { select: { pointsMonthly: true, name: true } } },
    }),
    getUsageProjection(ctx.workspaceId),
  ]);

  const allowance = subscription?.plan.pointsMonthly ?? 0;

  return {
    counters: {
      inbox,
      queue,
      approvals,
      notifications,
      autopilot: approvals,
    },
    points: {
      balance: projection.balance,
      monthlyAllowance: allowance,
      // The meter shows runway, not a fraction: a balance topped up above the
      // monthly allowance would otherwise render as a full bar reading
      // "nothing used", which is the opposite of the truth.
      averagePerDay: projection.averagePerDay,
      daysRemaining: projection.daysRemaining,
      planName: subscription?.plan.name ?? "No plan",
    },
  };
}
