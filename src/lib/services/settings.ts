import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { toPlain } from "@/lib/serialize";
import { getUsageProjection } from "@/lib/services/points";
import { SYSTEM_ROLES, PERMISSIONS } from "@/lib/auth/permissions";

export async function getAccountSettings(ctx: AuthContext) {
  const [user, sessions] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        avatarUrl: true,
        locale: true,
        timezone: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    db.session.findMany({
      where: { userId: ctx.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
      },
    }),
  ]);

  return toPlain({
    user,
    sessions: sessions.map((s) => ({ ...s, isCurrent: s.id === ctx.sessionId })),
    memberships: ctx.workspaces,
  });
}

export async function getTeamSettings(ctx: AuthContext) {
  const [members, roles] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { joinedAt: "asc" }],
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true, lastLoginAt: true },
        },
        role: { select: { id: true, key: true, name: true, permissions: true } },
      },
    }),
    db.role.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { members: true } } },
    }),
  ]);

  // Per-member workload, so a manager can see who is actually carrying deals.
  const workload = await db.lead.groupBy({
    by: ["ownerId"],
    where: { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: null },
    _count: true,
  });
  const dealLoad = await db.deal.groupBy({
    by: ["ownerId"],
    where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "OPEN" },
    _count: true,
    _sum: { valueInr: true },
  });

  const leadsBy = new Map(workload.map((w) => [w.ownerId, w._count]));
  const dealsBy = new Map(
    dealLoad.map((d) => [d.ownerId, { count: d._count, inr: Number(d._sum.valueInr ?? 0) }])
  );

  return toPlain({
    members: members.map((m) => ({
      id: m.id,
      title: m.title,
      joinedAt: m.joinedAt,
      dailyPointCap: m.dailyPointCap,
      skills: m.skills,
      stepCapacity: m.stepCapacity,
      isAway: m.isAway,
      user: m.user,
      role: { id: m.role.id, key: m.role.key, name: m.role.name },
      permissionCount: m.role.permissions.length,
      isYou: m.userId === ctx.userId,
      leadCount: leadsBy.get(m.userId) ?? 0,
      openDealCount: dealsBy.get(m.userId)?.count ?? 0,
      openDealInr: dealsBy.get(m.userId)?.inr ?? 0,
    })),
    roles: roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions,
      memberCount: r._count.members,
    })),
    allPermissions: Object.values(PERMISSIONS),
    systemRoleKeys: Object.keys(SYSTEM_ROLES),
  });
}

export async function getBillingSettings(ctx: AuthContext) {
  const [subscription, ledger, projection, plans, spendByType] = await Promise.all([
    db.subscription.findUnique({
      where: { workspaceId: ctx.workspaceId },
      include: { plan: true },
    }),
    db.pointLedger.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    getUsageProjection(ctx.workspaceId),
    db.plan.findMany({ where: { isPublic: true }, orderBy: { sortOrder: "asc" } }),
    db.pointLedger.groupBy({
      by: ["type"],
      where: {
        workspaceId: ctx.workspaceId,
        delta: { lt: 0 },
        createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
      _sum: { delta: true },
      _count: true,
    }),
  ]);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todaySpend = ledger
    .filter((l) => l.delta < 0 && l.createdAt >= startOfToday)
    .reduce((s, l) => s + Math.abs(l.delta), 0);

  return toPlain({
    subscription: subscription
      ? {
          status: subscription.status,
          seats: subscription.seats,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          trialEndsAt: subscription.trialEndsAt,
          plan: {
            key: subscription.plan.key,
            name: subscription.plan.name,
            priceMonthly: subscription.plan.priceMonthly,
            pointsMonthly: subscription.plan.pointsMonthly,
            seatsIncluded: subscription.plan.seatsIncluded,
            features: subscription.plan.features,
          },
        }
      : null,
    ledger: ledger.map((l) => ({
      id: l.id,
      type: l.type,
      delta: l.delta,
      balanceAfter: l.balanceAfter,
      reason: l.reason,
      actorType: l.actorType,
      createdAt: l.createdAt,
    })),
    projection,
    todaySpend,
    spendByType: spendByType.map((s) => ({
      type: s.type,
      points: Math.abs(Number(s._sum.delta ?? 0)),
      count: s._count,
    })),
    plans: plans.map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      priceMonthly: p.priceMonthly,
      priceYearly: p.priceYearly,
      seatsIncluded: p.seatsIncluded,
      pointsMonthly: p.pointsMonthly,
      features: p.features,
      isCurrent: p.key === subscription?.plan.key,
    })),
  });
}

export async function getAuditLog(
  ctx: AuthContext,
  opts: { source?: string; page?: number } = {}
) {
  const page = opts.page ?? 1;
  const pageSize = 50;
  const where = {
    workspaceId: ctx.workspaceId,
    ...(opts.source ? { source: opts.source as never } : {}),
  };

  const [rows, total, sources] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actorUser: { select: { id: true, name: true, avatarUrl: true } } },
    }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({
      by: ["source"],
      where: { workspaceId: ctx.workspaceId },
      _count: true,
    }),
  ]);

  return toPlain({
    rows: rows.map((r) => ({
      id: r.id,
      actorType: r.actorType,
      actorLabel: r.actorLabel,
      actorUser: r.actorUser,
      source: r.source,
      action: r.action,
      objectType: r.objectType,
      objectId: r.objectId,
      before: r.before,
      after: r.after,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    sources: sources.map((s) => ({ source: s.source, count: s._count })),
  });
}
