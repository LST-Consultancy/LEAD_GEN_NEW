import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { hasIngestionSource } from "@/lib/ingest/sources";

/**
 * §41 / §46 — searching the people and companies this workspace already holds.
 *
 * The honest boundary of this feature: it searches **your** data, not a
 * third-party database. Nothing here reaches outside, because no discovery
 * source is connected — and a "people search" that quietly only looks at rows
 * you already own would be the most misleading screen in the product.
 */

const filtersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  seniority: z.array(z.string()).max(12).default([]),
  department: z.array(z.string()).max(12).default([]),
  industry: z.array(z.string()).max(20).default([]),
  state: z.array(z.string()).max(30).default([]),
  /** Only people already attached to a lead, or only those not yet. */
  attachment: z.enum(["any", "is_lead", "not_lead"]).default("any"),
  decisionMakersOnly: z.boolean().default(false),
  hasContact: z.enum(["any", "revealed", "locked", "none"]).default("any"),
  minIntent: z.number().int().min(0).max(100).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});

export type PeopleFilters = z.input<typeof filtersSchema>;

export async function findPeople(ctx: AuthContext, raw: PeopleFilters = {}) {
  const f = filtersSchema.parse(raw);
  const visible = leadVisibilityFilter(ctx);

  const employments = await db.employment.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      isCurrent: true,
      ...(f.decisionMakersOnly ? { isDecisionMaker: true } : {}),
      ...(f.seniority.length > 0 ? { seniority: { in: f.seniority } } : {}),
      ...(f.department.length > 0 ? { department: { in: f.department } } : {}),
      company: {
        deletedAt: null,
        ...(f.industry.length > 0 ? { industry: { in: f.industry } } : {}),
        ...(f.state.length > 0 ? { state: { in: f.state } } : {}),
        ...(f.minIntent > 0 ? { intentScore: { gte: f.minIntent } } : {}),
      },
      ...(f.q
        ? {
            OR: [
              { title: { contains: f.q, mode: "insensitive" } },
              { person: { fullName: { contains: f.q, mode: "insensitive" } } },
              { company: { name: { contains: f.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ company: { intentScore: "desc" } }, { isDecisionMaker: "desc" }],
    take: f.limit * 2,
    include: {
      person: {
        select: {
          id: true,
          fullName: true,
          headline: true,
          avatarUrl: true,
          linkedinUrl: true,
          contactMethods: {
            select: { kind: true, isLocked: true, status: true, optedOutAt: true },
          },
          leads: {
            where: { workspaceId: ctx.workspaceId, deletedAt: null, ...visible },
            select: {
              id: true,
              tier: true,
              intent: true,
              status: true,
              score: { select: { displayScore: true } },
            },
            take: 1,
          },
        },
      },
      company: {
        select: {
          id: true,
          name: true,
          industry: true,
          city: true,
          state: true,
          employeeCount: true,
          intentScore: true,
          lastSignalAt: true,
        },
      },
    },
  });

  const rows = employments
    .map((e) => {
      const lead = e.person.leads[0] ?? null;
      const contacts = e.person.contactMethods;
      const revealed = contacts.filter((c) => !c.isLocked).length;
      const locked = contacts.filter((c) => c.isLocked).length;

      return {
        personId: e.person.id,
        name: e.person.fullName,
        headline: e.person.headline,
        avatarUrl: e.person.avatarUrl,
        linkedinUrl: e.person.linkedinUrl,
        title: e.title,
        department: e.department,
        seniority: e.seniority,
        isDecisionMaker: e.isDecisionMaker,
        company: e.company,
        lead: lead
          ? {
              id: lead.id,
              tier: lead.tier,
              intent: lead.intent,
              status: lead.status,
              score: lead.score ? Number(lead.score.displayScore) : null,
            }
          : null,
        contacts: {
          revealed,
          locked,
          optedOut: contacts.some((c) => c.optedOutAt !== null),
        },
      };
    })
    .filter((r) => {
      if (f.attachment === "is_lead" && !r.lead) return false;
      if (f.attachment === "not_lead" && r.lead) return false;
      if (f.hasContact === "revealed" && r.contacts.revealed === 0) return false;
      if (f.hasContact === "locked" && r.contacts.locked === 0) return false;
      if (f.hasContact === "none" && r.contacts.revealed + r.contacts.locked > 0) return false;
      return true;
    })
    .slice(0, f.limit);

  return {
    rows,
    /**
     * The count *before* the visibility-dependent filters, so a rep can tell
     * "there are none" from "there are some you cannot see".
     */
    examined: employments.length,
    /**
     * Stated on every result set: this searched your workspace, nothing more.
     */
    scope: hasIngestionSource()
      ? "Your workspace, plus connected discovery sources."
      : "Your workspace only. No discovery source is connected, so this cannot find people you do not already hold.",
    externalSearchAvailable: hasIngestionSource(),
  };
}

/** The filter vocabulary, drawn from the data rather than hard-coded. */
export async function getPeopleFacets(ctx: AuthContext) {
  const [seniorities, departments, industries, states] = await Promise.all([
    db.employment.groupBy({
      by: ["seniority"],
      where: { workspaceId: ctx.workspaceId, isCurrent: true, seniority: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { seniority: "desc" } },
      take: 12,
    }),
    db.employment.groupBy({
      by: ["department"],
      where: { workspaceId: ctx.workspaceId, isCurrent: true, department: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { department: "desc" } },
      take: 12,
    }),
    db.company.groupBy({
      by: ["industry"],
      where: { workspaceId: ctx.workspaceId, deletedAt: null, industry: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { industry: "desc" } },
      take: 20,
    }),
    db.company.groupBy({
      by: ["state"],
      where: { workspaceId: ctx.workspaceId, deletedAt: null, state: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { state: "desc" } },
      take: 20,
    }),
  ]);

  const clean = <T extends { _count: { _all: number } }>(
    rows: T[],
    key: keyof T
  ): { value: string; count: number }[] =>
    rows
      .map((r) => ({ value: String(r[key] ?? ""), count: r._count._all }))
      .filter((r) => r.value.length > 0);

  return {
    seniorities: clean(seniorities, "seniority"),
    departments: clean(departments, "department"),
    industries: clean(industries, "industry"),
    states: clean(states, "state"),
  };
}

/**
 * §45 — company-level intelligence, including the buying committee.
 */
export async function listAccounts(
  ctx: AuthContext,
  opts: { q?: string; limit?: number } = {}
) {
  const visible = leadVisibilityFilter(ctx);

  const companies = await db.company.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...(opts.q ? { name: { contains: opts.q, mode: "insensitive" } } : {}),
    },
    orderBy: [{ intentScore: "desc" }, { lastSignalAt: "desc" }],
    take: opts.limit ?? 60,
    include: {
      committee: {
        orderBy: { influence: "desc" },
        select: {
          role: true,
          influence: true,
          sentiment: true,
          confirmedAt: true,
          person: { select: { id: true, fullName: true } },
        },
      },
      leads: {
        where: { deletedAt: null, ...visible },
        select: {
          id: true,
          tier: true,
          intent: true,
          status: true,
          person: { select: { fullName: true } },
        },
      },
      deals: {
        where: { deletedAt: null },
        select: { id: true, title: true, valueInr: true, status: true, stage: { select: { name: true } } },
      },
      signals: {
        orderBy: { occurredAt: "desc" },
        take: 3,
        select: { title: true, type: true, occurredAt: true },
      },
      _count: { select: { signals: true, conversations: true } },
    },
  });

  return companies.map((c) => {
    const open = c.deals.filter((d) => d.status === "OPEN");
    const won = c.deals.filter((d) => d.status === "WON");

    /**
     * Whether the committee is mapped well enough to act on. A single known
     * contact at a company is not a committee, and calling it one is how a
     * deal gets single-threaded without anyone noticing.
     */
    const confirmed = c.committee.filter((m) => m.confirmedAt !== null).length;
    const hasDecisionMaker = c.committee.some(
      (m) => m.role === "DECISION_MAKER" || m.role === "CHAMPION"
    );
    const blockers = c.committee.filter((m) => m.role === "BLOCKER");

    return {
      id: c.id,
      name: c.name,
      domain: c.domain,
      industry: c.industry,
      city: c.city,
      state: c.state,
      employeeCount: c.employeeCount,
      technologies: c.technologies,
      intentScore: c.intentScore,
      lastSignalAt: c.lastSignalAt?.toISOString() ?? null,
      signalCount: c._count.signals,
      conversationCount: c._count.conversations,
      recentSignals: c.signals.map((s) => ({
        title: s.title,
        type: s.type,
        at: s.occurredAt.toISOString(),
      })),
      leads: c.leads.map((l) => ({
        id: l.id,
        name: l.person.fullName,
        tier: l.tier,
        intent: l.intent,
        status: l.status,
      })),
      openDeals: open.map((d) => ({
        id: d.id,
        title: d.title,
        valueInr: Number(d.valueInr),
        stage: d.stage.name,
      })),
      openValueInr: open.reduce((n, d) => n + Number(d.valueInr), 0),
      wonValueInr: won.reduce((n, d) => n + Number(d.valueInr), 0),
      committee: c.committee.map((m) => ({
        personId: m.person.id,
        name: m.person.fullName,
        role: m.role,
        influence: m.influence,
        sentiment: m.sentiment,
        confirmed: m.confirmedAt !== null,
      })),
      committeeHealth: {
        mapped: c.committee.length,
        confirmed,
        hasDecisionMaker,
        blockers: blockers.length,
        /**
         * Single-threaded means one known contact carrying the whole
         * relationship — the most common reason a deal dies quietly.
         */
        singleThreaded: c.committee.length <= 1 && open.length > 0,
      },
    };
  });
}

/**
 * §44 — Lead Lens: look up whatever was pasted.
 *
 * Searches the workspace by name, company, LinkedIn URL or domain. When
 * nothing matches, it says so and explains that on-demand enrichment needs a
 * data provider — rather than returning an empty dossier that looks like a
 * failure.
 */
export async function lookUp(ctx: AuthContext, rawQuery: string) {
  const q = rawQuery.trim();
  if (q.length < 2) {
    return { query: q, kind: "too_short" as const, people: [], companies: [] };
  }

  const isUrl = /^https?:\/\//i.test(q) || q.includes("linkedin.com/");
  const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(q) && !q.includes(" ");
  const visible = leadVisibilityFilter(ctx);

  const [people, companies] = await Promise.all([
    db.person.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(isUrl
          ? { linkedinUrl: { contains: q.replace(/^https?:\/\//i, ""), mode: "insensitive" } }
          : { fullName: { contains: q, mode: "insensitive" } }),
      },
      take: 10,
      select: {
        id: true,
        fullName: true,
        headline: true,
        avatarUrl: true,
        linkedinUrl: true,
        employments: {
          where: { isCurrent: true },
          select: { title: true, company: { select: { id: true, name: true, industry: true } } },
          take: 1,
        },
        leads: {
          where: { workspaceId: ctx.workspaceId, deletedAt: null, ...visible },
          select: { id: true, tier: true, intent: true, score: { select: { displayScore: true } } },
          take: 1,
        },
      },
    }),
    db.company.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        ...(isDomain
          ? { domain: { contains: q, mode: "insensitive" } }
          : { name: { contains: q, mode: "insensitive" } }),
      },
      take: 10,
      select: {
        id: true,
        name: true,
        domain: true,
        industry: true,
        city: true,
        employeeCount: true,
        intentScore: true,
        _count: { select: { leads: true, signals: true } },
      },
    }),
  ]);

  return {
    query: q,
    kind: (isUrl ? "url" : isDomain ? "domain" : "name") as "url" | "domain" | "name",
    people: people.map((p) => ({
      id: p.id,
      name: p.fullName,
      headline: p.headline,
      avatarUrl: p.avatarUrl,
      linkedinUrl: p.linkedinUrl,
      title: p.employments[0]?.title ?? null,
      company: p.employments[0]?.company ?? null,
      lead: p.leads[0]
        ? {
            id: p.leads[0].id,
            tier: p.leads[0].tier,
            intent: p.leads[0].intent,
            score: p.leads[0].score ? Number(p.leads[0].score.displayScore) : null,
          }
        : null,
    })),
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      industry: c.industry,
      city: c.city,
      employeeCount: c.employeeCount,
      intentScore: c.intentScore,
      leadCount: c._count.leads,
      signalCount: c._count.signals,
    })),
  };
}
