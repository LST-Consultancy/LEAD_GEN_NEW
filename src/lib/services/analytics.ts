import "server-only";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { SIGNAL_SOURCE_LABEL } from "@/lib/vocab";

/**
 * §50 / §51 — the funnel from signal to revenue, and who is converting.
 *
 * Every figure here is a count of rows, and every ratio names both of its
 * terms. A conversion rate with no denominator on screen is the easiest number
 * in a sales tool to misread, so the denominators are shown.
 */

const DAY = 86_400_000;

/**
 * The funnel: signal → lead → contacted → replied → deal → won.
 *
 * Counted at each stage rather than derived from the one before, because a
 * lead can be contacted without a signal and a deal can exist without a reply.
 * Deriving would produce rates above 100% and quietly hide the real shape.
 */
export async function getFunnel(ctx: AuthContext, opts: { days?: number } = {}) {
  const days = opts.days ?? 90;
  const since = new Date(Date.now() - days * DAY);
  const w = { workspaceId: ctx.workspaceId };

  const [signals, leads, contacted, replied, deals, won, lost] = await Promise.all([
    db.signal.count({ where: { ...w, deletedAt: null, occurredAt: { gte: since } } }),
    db.lead.count({ where: { ...w, deletedAt: null, surfacedAt: { gte: since } } }),
    db.lead.count({ where: { ...w, deletedAt: null, lastContactedAt: { gte: since } } }),
    db.lead.count({ where: { ...w, deletedAt: null, repliedAt: { gte: since } } }),
    db.deal.count({ where: { ...w, deletedAt: null, createdAt: { gte: since } } }),
    db.deal.aggregate({
      where: { ...w, deletedAt: null, status: "WON", wonAt: { gte: since } },
      _count: { _all: true },
      _sum: { valueInr: true },
    }),
    db.deal.aggregate({
      where: { ...w, deletedAt: null, status: "LOST", lostAt: { gte: since } },
      _count: { _all: true },
      _sum: { valueInr: true },
    }),
  ]);

  const stages = [
    { key: "signals", label: "Signals detected", count: signals },
    { key: "leads", label: "Leads surfaced", count: leads },
    { key: "contacted", label: "Contacted", count: contacted },
    { key: "replied", label: "Replied", count: replied },
    { key: "deals", label: "Deals created", count: deals },
    { key: "won", label: "Won", count: won._count._all },
  ];

  return {
    windowDays: days,
    stages: stages.map((s, i) => {
      const prev = i > 0 ? stages[i - 1] : null;
      return {
        ...s,
        /** Against the stage before it, with both terms kept for the label. */
        fromPrevious:
          prev && prev.count > 0 ? Math.round((s.count / prev.count) * 100) : null,
        previousLabel: prev?.label ?? null,
        previousCount: prev?.count ?? null,
      };
    }),
    wonInr: Number(won._sum.valueInr ?? 0),
    lostCount: lost._count._all,
    lostInr: Number(lost._sum.valueInr ?? 0),
    /**
     * Stated because the stages are counted independently over the same
     * window: a lead surfaced before the window but contacted inside it counts
     * at "contacted" and not at "leads". The percentages are therefore a shape,
     * not a cohort.
     */
    caveat:
      "Each stage counts what happened in this window, not one cohort moving through it. A lead surfaced earlier but contacted now appears at 'contacted' only — so treat the percentages as shape rather than as one group's journey.",
  };
}

/**
 * Which sources actually produce money.
 *
 * Attribution runs lead → search phrase → source kind (or, with no phrase, the
 * source of the lead's earliest signal), and revenue follows the
 * deals on those leads. Leads with no phrase are reported as their own row
 * rather than dropped, because "we do not know where most of our revenue came
 * from" is the finding.
 */
export async function getSourceAttribution(ctx: AuthContext) {
  const leads = await db.lead.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      tier: true,
      repliedAt: true,
      sourcePhrase: { select: { id: true, phrase: true, sourceKind: true } },
      // Leads converted from an opportunity carry its source as their first signal.
      signals: { where: { deletedAt: null }, orderBy: { occurredAt: "asc" }, take: 1, select: { sourceKind: true } },
      deals: {
        where: { deletedAt: null },
        select: { valueInr: true, status: true },
      },
    },
  });

  const buckets = new Map<
    string,
    {
      key: string;
      label: string;
      leads: number;
      tierA: number;
      replied: number;
      deals: number;
      openInr: number;
      wonInr: number;
      wonCount: number;
    }
  >();

  for (const lead of leads) {
    const kind = lead.sourcePhrase?.sourceKind ?? lead.signals[0]?.sourceKind ?? null;
    const key = kind ?? "__unattributed";
    const label = kind ? (SIGNAL_SOURCE_LABEL[kind] ?? kind) : "No recorded source";

    const row =
      buckets.get(key) ??
      {
        key,
        label,
        leads: 0,
        tierA: 0,
        replied: 0,
        deals: 0,
        openInr: 0,
        wonInr: 0,
        wonCount: 0,
      };

    row.leads += 1;
    if (lead.tier === "A") row.tierA += 1;
    if (lead.repliedAt) row.replied += 1;
    row.deals += lead.deals.length;
    for (const d of lead.deals) {
      if (d.status === "OPEN") row.openInr += Number(d.valueInr);
      if (d.status === "WON") {
        row.wonInr += Number(d.valueInr);
        row.wonCount += 1;
      }
    }
    buckets.set(key, row);
  }

  const rows = [...buckets.values()]
    .map((r) => ({
      ...r,
      /** Null, not zero, when nothing has been contacted from this source. */
      replyRate: r.leads > 0 ? Math.round((r.replied / r.leads) * 100) : null,
      revenuePerLead: r.leads > 0 ? Math.round(r.wonInr / r.leads) : 0,
    }))
    .sort((a, b) => b.wonInr - a.wonInr || b.leads - a.leads);

  const attributed = rows.filter((r) => r.key !== "__unattributed");
  const unattributed = rows.find((r) => r.key === "__unattributed");

  return {
    rows,
    totalLeads: leads.length,
    attributedLeads: attributed.reduce((n, r) => n + r.leads, 0),
    unattributedLeads: unattributed?.leads ?? 0,
    unattributedWonInr: unattributed?.wonInr ?? 0,
    /** How much of the revenue can be traced to a source at all. */
    attributionCoverage:
      leads.length > 0
        ? Math.round((attributed.reduce((n, r) => n + r.leads, 0) / leads.length) * 100)
        : null,
  };
}

/**
 * §51 — per-person activity and conversion.
 *
 * The question this exists to answer is "who is busy but not converting?",
 * which needs both numbers side by side. Either alone is misleading: high
 * activity reads as productivity, and high conversion on three leads reads as
 * skill.
 */
export async function getTeamPerformance(ctx: AuthContext, opts: { days?: number } = {}) {
  const days = opts.days ?? 30;
  const since = new Date(Date.now() - days * DAY);

  const members = await db.workspaceMember.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      role: { select: { name: true } },
    },
  });

  const rows = await Promise.all(
    members.map(async (m) => {
      const owned = { workspaceId: ctx.workspaceId, deletedAt: null, ownerId: m.userId };

      const [leads, contacted, replied, activities, deals, won, tasksOpen, tasksOverdue] =
        await Promise.all([
          db.lead.count({ where: owned }),
          db.lead.count({ where: { ...owned, lastContactedAt: { gte: since } } }),
          db.lead.count({ where: { ...owned, repliedAt: { gte: since } } }),
          db.activity.count({
            where: {
              workspaceId: ctx.workspaceId,
              actorUserId: m.userId,
              occurredAt: { gte: since },
            },
          }),
          db.deal.count({
            where: { workspaceId: ctx.workspaceId, deletedAt: null, ownerId: m.userId },
          }),
          db.deal.aggregate({
            where: {
              workspaceId: ctx.workspaceId,
              deletedAt: null,
              ownerId: m.userId,
              status: "WON",
              wonAt: { gte: since },
            },
            _count: { _all: true },
            _sum: { valueInr: true },
          }),
          db.task.count({
            where: {
              workspaceId: ctx.workspaceId,
              deletedAt: null,
              ownerId: m.userId,
              completedAt: null,
            },
          }),
          db.task.count({
            where: {
              workspaceId: ctx.workspaceId,
              deletedAt: null,
              ownerId: m.userId,
              completedAt: null,
              dueAt: { lt: new Date() },
            },
          }),
        ]);

      const replyRate = contacted > 0 ? Math.round((replied / contacted) * 100) : null;

      return {
        userId: m.userId,
        name: m.user.name,
        avatarUrl: m.user.avatarUrl,
        role: m.role.name,
        leads,
        contacted,
        replied,
        replyRate,
        activities,
        deals,
        wonCount: won._count._all,
        wonInr: Number(won._sum.valueInr ?? 0),
        tasksOpen,
        tasksOverdue,
        /**
         * The pattern worth naming: plenty of outbound, nothing coming back.
         * Requires enough volume to mean anything — a 0% reply rate on two
         * sends is noise, not a finding.
         */
        busyNotConverting: contacted >= 10 && (replyRate ?? 0) < 10,
      };
    })
  );

  const active = rows.filter((r) => r.leads > 0 || r.activities > 0);

  return {
    windowDays: days,
    rows: rows.sort((a, b) => b.wonInr - a.wonInr || b.activities - a.activities),
    teamSize: members.length,
    activeCount: active.length,
    /** The threshold is on screen so a reader knows what the flag means. */
    busyNotConvertingThreshold: {
      minContacted: 10,
      maxReplyRate: 10,
    },
  };
}

/**
 * One cohort followed forward: the leads surfaced in the window, and how many
 * of *those* were later contacted, replied, got a deal, and won. The funnel
 * above counts each stage independently; this is the other reading, and the
 * two are shown side by side because either alone misleads.
 */
export async function getCohortFunnel(ctx: AuthContext, opts: { days?: number } = {}) {
  const days = opts.days ?? 90;
  const since = new Date(Date.now() - days * 86_400_000);
  const cohort = { workspaceId: ctx.workspaceId, deletedAt: null, surfacedAt: { gte: since }, ...leadVisibilityFilter(ctx) };
  const [surfaced, contacted, replied, withDeal, won] = await Promise.all([
    db.lead.count({ where: cohort }),
    db.lead.count({ where: { ...cohort, lastContactedAt: { not: null } } }),
    db.lead.count({ where: { ...cohort, repliedAt: { not: null } } }),
    db.lead.count({ where: { ...cohort, deals: { some: { deletedAt: null } } } }),
    db.lead.count({ where: { ...cohort, deals: { some: { deletedAt: null, status: "WON" } } } }),
  ]);
  const stages = [
    { key: "surfaced", label: "Surfaced in window", count: surfaced },
    { key: "contacted", label: "…later contacted", count: contacted },
    { key: "replied", label: "…replied", count: replied },
    { key: "deal", label: "…got a deal", count: withDeal },
    { key: "won", label: "…won", count: won },
  ];
  return {
    days,
    // A share of zero leads is withheld, not 0%.
    stages: stages.map((s) => ({ ...s, shareOfCohort: surfaced > 0 ? s.count / surfaced : null })),
  };
}

/** Leads by tier and status, as counted — the mix a score threshold is judged against. */
export async function getLeadMix(ctx: AuthContext) {
  const rows = await db.lead.groupBy({
    by: ["tier", "status"],
    where: { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: null, ...leadVisibilityFilter(ctx) },
    _count: { _all: true },
  });
  return rows.map((r) => ({ tier: r.tier, status: r.status, count: r._count._all }));
}
