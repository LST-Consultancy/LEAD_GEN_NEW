import "server-only";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { hasIngestionSource } from "@/lib/ingest/sources";
// Signals here come from search-phrase watching, which no provider feeds yet; discovered
// opportunities are a separate record and have their own screens.
import { SIGNAL_TYPE_LABEL } from "@/lib/vocab";

/**
 * §42 / §47 / §48 — the signal-derived views.
 *
 * All four screens built on this share one constraint worth stating on each of
 * them: **no discovery source is connected**, so nothing new arrives. Every
 * figure below is over signals already recorded. A "live" feed that is
 * actually a static archive is the single most misleading thing this part of
 * the product could be, so the staleness is measured and shown rather than
 * left to be inferred from dates.
 */

const DAY = 86_400_000;

/**
 * How current the signal data actually is.
 *
 * Shared by every screen here, so none of them can imply freshness the others
 * contradict.
 */
export async function getSignalFreshness(ctx: AuthContext) {
  const [newest, oldest, total, last7] = await Promise.all([
    db.signal.findFirst({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: { detectedAt: "desc" },
      select: { detectedAt: true },
    }),
    db.signal.findFirst({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: { detectedAt: "asc" },
      select: { detectedAt: true },
    }),
    db.signal.count({ where: { workspaceId: ctx.workspaceId, deletedAt: null } }),
    db.signal.count({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        detectedAt: { gte: new Date(Date.now() - 7 * DAY) },
      },
    }),
  ]);

  const connected = hasIngestionSource();
  const newestAt = newest?.detectedAt ?? null;
  const ageHours = newestAt ? Math.floor((Date.now() - newestAt.getTime()) / 3_600_000) : null;

  return {
    connected,
    total,
    last7,
    newestAt: newestAt?.toISOString() ?? null,
    oldestAt: oldest?.detectedAt.toISOString() ?? null,
    newestAgeHours: ageHours,
    /** The sentence every signal screen shows. */
    notice: connected
      ? `${total} signals, ${last7} in the last week.`
      : total === 0
        ? "No signals recorded yet. Search-phrase watching has no connected source; opportunities found by your connected providers are under Opportunities, and converting one to a lead records its evidence here."
        : `${total} signals recorded, the newest ${ageHours !== null && ageHours < 48 ? `${ageHours} hours` : "some time"} old. Search-phrase watching has no connected source, so new signals arrive only when an opportunity is converted to a lead.`,
  };
}

/**
 * §42 — Live Demand: signals grouped into categories you can act on.
 *
 * Grouped by what the signal *means* rather than by its source, because
 * "someone is hiring for a role you sell into" and "someone published a
 * tender" call for different responses even though both arrived from the web.
 */
const DEMAND_CATEGORIES: { key: string; label: string; meaning: string; types: string[] }[] = [
  {
    key: "in_market",
    label: "Actively in market",
    meaning: "They have said publicly that they are buying. The highest-intent thing there is.",
    types: ["RFP"],
  },
  {
    key: "capacity",
    label: "New capacity or money",
    meaning: "Funding or expansion — budget exists that did not before.",
    types: ["FUNDING", "ANNOUNCEMENT"],
  },
  {
    key: "hiring",
    label: "Hiring into the problem",
    meaning: "Hiring for a role implies the platform decision is made and budget is approved.",
    types: ["HIRING"],
  },
  {
    key: "people_moved",
    label: "Someone moved",
    meaning: "A new person re-evaluates vendors in their first ninety days.",
    types: ["JOB_CHANGE"],
  },
  {
    key: "stack_changed",
    label: "Stack changed",
    meaning: "A technology went in or came out — integration and migration work follows.",
    types: ["TECH_CHANGE", "WEBSITE_UPDATE"],
  },
  {
    key: "said_something",
    label: "Said something publicly",
    meaning: "A post or comment naming a problem in their own words.",
    types: ["SOCIAL_POST", "SOCIAL_COMMENT", "NEWS", "REVIEW"],
  },
  {
    key: "competitor",
    label: "Competitor mentioned",
    meaning: "They named someone you compete with. Worth reading before you write.",
    types: ["COMPETITOR_MENTION"],
  },
];

export async function getLiveDemand(ctx: AuthContext, opts: { days?: number } = {}) {
  const since = new Date(Date.now() - (opts.days ?? 30) * DAY);
  const visible = leadVisibilityFilter(ctx);

  const signals = await db.signal.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      occurredAt: { gte: since },
    },
    orderBy: [{ intentDelta: "desc" }, { occurredAt: "desc" }],
    take: 400,
    select: {
      id: true,
      type: true,
      title: true,
      excerpt: true,
      sourceName: true,
      sourceUrl: true,
      confidence: true,
      intentDelta: true,
      occurredAt: true,
      suggestedAction: true,
      company: { select: { id: true, name: true, industry: true, city: true } },
      lead: {
        select: {
          id: true,
          tier: true,
          intent: true,
          ownerId: true,
          person: { select: { fullName: true } },
        },
      },
    },
  });

  // Visibility applies to the lead link, not to the signal itself — a signal
  // about a company is workspace knowledge even if the lead is someone else's.
  const withVisibility = signals.map((s) => ({
    ...s,
    lead:
      s.lead && (!visible.ownerId || s.lead.ownerId === visible.ownerId)
        ? { id: s.lead.id, tier: s.lead.tier, intent: s.lead.intent, name: s.lead.person.fullName }
        : null,
  }));

  const categories = DEMAND_CATEGORIES.map((c) => {
    const matched = withVisibility.filter((s) => c.types.includes(s.type));
    return {
      ...c,
      count: matched.length,
      /** Companies, not signals — five posts from one company is one opportunity. */
      companies: new Set(matched.map((s) => s.company?.id).filter(Boolean)).size,
      topIntent: matched.reduce((n, s) => Math.max(n, s.intentDelta), 0),
      signals: matched.slice(0, 8).map((s) => ({
        id: s.id,
        type: s.type,
        typeLabel: SIGNAL_TYPE_LABEL[s.type] ?? s.type,
        title: s.title,
        excerpt: s.excerpt,
        source: s.sourceName,
        sourceUrl: s.sourceUrl,
        confidence: s.confidence,
        intentDelta: s.intentDelta,
        at: s.occurredAt.toISOString(),
        suggestedAction: s.suggestedAction,
        company: s.company,
        lead: s.lead,
      })),
    };
  }).filter((c) => c.count > 0);

  const uncategorised = withVisibility.filter(
    (s) => !DEMAND_CATEGORIES.some((c) => c.types.includes(s.type))
  );

  return {
    windowDays: opts.days ?? 30,
    total: withVisibility.length,
    categories,
    /** Named rather than silently dropped, so the numbers add up. */
    uncategorised: uncategorised.length,
    uncategorisedTypes: [...new Set(uncategorised.map((s) => s.type))],
  };
}

/** §47 — what is being watched, and whether anything feeds it. */
export async function getRadar(ctx: AuthContext) {
  const watches = await db.radarWatch.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  // Signals that arrived since each watch was created, as evidence of whether
  // it has ever produced anything.
  const signalCounts = await db.signal.groupBy({
    by: ["companyId"],
    where: { workspaceId: ctx.workspaceId, deletedAt: null, companyId: { not: null } },
    _count: { _all: true },
  });
  const byCompany = new Map(signalCounts.map((s) => [s.companyId, s._count._all]));

  return watches.map((w) => ({
    id: w.id,
    targetKind: w.targetKind,
    targetLabel: w.targetLabel,
    targetId: w.targetId,
    frequency: w.frequency,
    alertOn: w.alertOn,
    stage: w.stage,
    confidence: w.confidence,
    isActive: w.isActive,
    lastAlertAt: w.lastAlertAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
    /** Signals recorded against the watched company, when it is a company. */
    signalsSeen: w.targetId ? (byCompany.get(w.targetId) ?? 0) : 0,
  }));
}

/** §48 — competitors and what has actually been said about them. */
export async function getCompetitors(ctx: AuthContext) {
  const competitors = await db.competitor.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: { name: "asc" },
  });

  // Every competitor-flavoured signal, matched to a competitor by name or
  // alias. Matching on the recorded text rather than a foreign key, because
  // that is how the mention actually arrives.
  const mentions = await db.signal.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      OR: [{ type: "COMPETITOR_MENTION" }, { keywords: { isEmpty: false } }],
    },
    orderBy: { occurredAt: "desc" },
    take: 300,
    select: {
      id: true,
      title: true,
      excerpt: true,
      type: true,
      keywords: true,
      occurredAt: true,
      sourceName: true,
      company: { select: { id: true, name: true } },
      lead: { select: { id: true } },
    },
  });

  const rows = competitors.map((c) => {
    const names = [c.name, ...c.aliases].map((n) => n.toLowerCase());
    const matched = mentions.filter((m) => {
      const haystack = `${m.title} ${m.excerpt} ${m.keywords.join(" ")}`.toLowerCase();
      return names.some((n) => haystack.includes(n));
    });

    return {
      id: c.id,
      name: c.name,
      domain: c.domain,
      aliases: c.aliases,
      notes: c.notes,
      isActive: c.isActive,
      mentionCount: matched.length,
      companiesMentioning: new Set(matched.map((m) => m.company?.id).filter(Boolean)).size,
      mentions: matched.slice(0, 6).map((m) => ({
        id: m.id,
        title: m.title,
        excerpt: m.excerpt,
        source: m.sourceName,
        at: m.occurredAt.toISOString(),
        company: m.company,
        leadId: m.lead?.id ?? null,
      })),
    };
  });

  return {
    competitors: rows,
    /**
     * Mentions that match no tracked competitor. Worth surfacing: it is how
     * you find out about one you are not tracking.
     */
    untracked: mentions.filter((m) => {
      const haystack = `${m.title} ${m.excerpt} ${m.keywords.join(" ")}`.toLowerCase();
      return !competitors.some((c) =>
        [c.name, ...c.aliases].some((n) => haystack.includes(n.toLowerCase()))
      );
    }).length,
  };
}

/** §49 — sector-level movement across the industries and cities sold into. */
export async function getMarketIntelligence(ctx: AuthContext, opts: { days?: number } = {}) {
  const days = opts.days ?? 90;
  const since = new Date(Date.now() - days * DAY);

  const [companies, signals, deals] = await Promise.all([
    db.company.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, industry: true, state: true, city: true, intentScore: true },
    }),
    db.signal.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, occurredAt: { gte: since } },
      select: { companyId: true, type: true, intentDelta: true, occurredAt: true },
    }),
    db.deal.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: {
        companyId: true,
        valueInr: true,
        status: true,
        company: { select: { industry: true, state: true } },
      },
    }),
  ]);

  const companyById = new Map(companies.map((c) => [c.id, c]));

  const bucket = <K extends "industry" | "state">(key: K) => {
    const map = new Map<
      string,
      { companies: number; signals: number; intent: number; openInr: number; wonInr: number }
    >();

    for (const c of companies) {
      const k = c[key];
      if (!k) continue;
      const row = map.get(k) ?? { companies: 0, signals: 0, intent: 0, openInr: 0, wonInr: 0 };
      row.companies += 1;
      row.intent += c.intentScore;
      map.set(k, row);
    }
    for (const s of signals) {
      const c = s.companyId ? companyById.get(s.companyId) : undefined;
      const k = c?.[key];
      if (!k) continue;
      const row = map.get(k);
      if (row) row.signals += 1;
    }
    for (const d of deals) {
      const k = d.company[key];
      if (!k) continue;
      const row = map.get(k);
      if (!row) continue;
      if (d.status === "OPEN") row.openInr += Number(d.valueInr);
      if (d.status === "WON") row.wonInr += Number(d.valueInr);
    }

    return [...map.entries()]
      .map(([value, r]) => ({
        value,
        ...r,
        /** Average intent, so a big sector does not simply outrank a hot one. */
        avgIntent: r.companies > 0 ? Math.round(r.intent / r.companies) : 0,
        signalsPerCompany: r.companies > 0 ? Number((r.signals / r.companies).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.signals - a.signals);
  };

  return {
    windowDays: days,
    industries: bucket("industry"),
    states: bucket("state"),
    /**
     * Stated plainly: this is your own pipeline's shape, not the market's. A
     * sector looks quiet here when you have few companies in it, which is a
     * fact about your data rather than about the sector.
     */
    caveat:
      "Computed from the companies, signals and deals in this workspace — it describes where your own pipeline is moving, not the market as a whole.",
  };
}

/**
 * Watches that actually run today, as distinct from the signal watches above
 * (which wait on a signal source that is not built). Opportunity watches are
 * re-searched by the worker on their cadence; lead-search alerts are checked by
 * the fifteen-minute notification sweep.
 */
export async function getRunningWatches(ctx: AuthContext) {
  const rows = await db.savedSearch.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, alertEnabled: true, surface: { in: ["leads", "opportunities"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, surface: true, frequency: true, lastAlertAt: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.surface === "opportunities" ? ("opportunity" as const) : ("lead_search" as const),
    frequency: r.frequency,
    lastAlertAt: r.lastAlertAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
