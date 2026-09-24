import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { toPlain } from "@/lib/serialize";
import { startOfLocalDay } from "@/lib/format";
import { leadFilterSchema, SHORTCUTS, type LeadFilter } from "@/lib/leads/filter";

// Re-exported so server callers have a single import site.
export { leadFilterSchema, SHORTCUTS };
export type { LeadFilter };

// --------------------------------------------------------------------------
// Filter contract — shared by the UI, the API and saved views.
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Query building
// --------------------------------------------------------------------------

/** Also used by export, so an export returns exactly what the Leads screen shows. */
export function buildWhere(ctx: AuthContext, f: Partial<LeadFilter>): Prisma.LeadWhereInput {
  const now = Date.now();

  // Tenant scope and row-level visibility are non-negotiable and always AND-ed,
  // regardless of the user's combine choice.
  const base: Prisma.LeadWhereInput = {
    workspaceId: ctx.workspaceId,
    deletedAt: null,
    discardedAt: null,
    ...leadVisibilityFilter(ctx),
    ...(f.includeArchived ? {} : { archivedAt: null }),
  };

  const clauses: Prisma.LeadWhereInput[] = [];

  if (f.q) {
    const q = f.q;
    clauses.push({
      OR: [
        { person: { fullName: { contains: q, mode: "insensitive" } } },
        { company: { name: { contains: q, mode: "insensitive" } } },
        { surfacedReason: { contains: q, mode: "insensitive" } },
        { person: { employments: { some: { title: { contains: q, mode: "insensitive" } } } } },
        { signals: { some: { title: { contains: q, mode: "insensitive" } } } },
        { signals: { some: { keywords: { has: q.toLowerCase() } } } },
      ],
    });
  }

  if (f.tiers?.length) clauses.push({ tier: { in: f.tiers } });
  if (f.statuses?.length) clauses.push({ status: { in: f.statuses } });
  if (f.intents?.length) clauses.push({ intent: { in: f.intents } });
  if (f.ownerIds?.length) clauses.push({ ownerId: { in: f.ownerIds } });
  if (f.starred) clauses.push({ isStarred: true });
  if (f.revealed !== undefined) clauses.push({ isRevealed: f.revealed });
  if (f.listId) clauses.push({ listMembers: { some: { listId: f.listId } } });

  if (f.minScore !== undefined || f.maxScore !== undefined) {
    clauses.push({
      score: {
        displayScore: {
          ...(f.minScore !== undefined ? { gte: f.minScore } : {}),
          ...(f.maxScore !== undefined ? { lte: f.maxScore } : {}),
        },
      },
    });
  }

  const companyFilter: Prisma.CompanyWhereInput = {};
  if (f.industries?.length) companyFilter.industry = { in: f.industries };
  if (f.cities?.length) companyFilter.city = { in: f.cities };
  if (f.states?.length) companyFilter.state = { in: f.states };
  if (f.countries?.length) companyFilter.country = { in: f.countries };
  if (f.tags?.length) companyFilter.tags = { hasSome: f.tags };
  if (f.technologies?.length) companyFilter.technologies = { hasSome: f.technologies };
  if (f.employeeMin !== undefined || f.employeeMax !== undefined) {
    companyFilter.employeeCount = {
      ...(f.employeeMin !== undefined ? { gte: f.employeeMin } : {}),
      ...(f.employeeMax !== undefined ? { lte: f.employeeMax } : {}),
    };
  }
  if (Object.keys(companyFilter).length) clauses.push({ company: companyFilter });

  const employmentFilter: Prisma.EmploymentWhereInput = { isCurrent: true };
  let hasEmploymentFilter = false;
  if (f.seniorities?.length) {
    employmentFilter.seniority = { in: f.seniorities };
    hasEmploymentFilter = true;
  }
  if (f.departments?.length) {
    employmentFilter.department = { in: f.departments };
    hasEmploymentFilter = true;
  }
  if (f.decisionMakersOnly) {
    employmentFilter.isDecisionMaker = true;
    hasEmploymentFilter = true;
  }
  if (hasEmploymentFilter) clauses.push({ person: { employments: { some: employmentFilter } } });

  if (f.signalTypes?.length) {
    clauses.push({ signals: { some: { type: { in: f.signalTypes as never } } } });
  }
  if (f.hasSignal) clauses.push({ signals: { some: {} } });
  if (f.sources?.length) clauses.push({ signals: { some: { sourceKind: { in: f.sources }, deletedAt: null } } });

  if (f.budgetMin !== undefined || f.budgetMax !== undefined) {
    clauses.push({
      estimatedBudgetInr: {
        ...(f.budgetMin !== undefined ? { gte: f.budgetMin } : {}),
        ...(f.budgetMax !== undefined ? { lte: f.budgetMax } : {}),
      },
    });
  }
  if (f.hasBudget) clauses.push({ estimatedBudgetInr: { not: null } });

  if (f.surfacedWithinDays !== undefined) {
    clauses.push({ surfacedAt: { gte: new Date(now - f.surfacedWithinDays * 86_400_000) } });
  }
  if (f.surfacedFrom || f.surfacedTo) {
    // Whole calendar days where the workspace is, the "to" day included.
    const tz = ctx.workspace.timezone ?? "Asia/Kolkata";
    const nextDay = (key: string) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
    clauses.push({
      surfacedAt: {
        ...(f.surfacedFrom ? { gte: startOfLocalDay(f.surfacedFrom, tz) } : {}),
        ...(f.surfacedTo ? { lt: startOfLocalDay(nextDay(f.surfacedTo), tz) } : {}),
      },
    });
  }
  if (f.notContactedForDays !== undefined) {
    const cutoff = new Date(now - f.notContactedForDays * 86_400_000);
    clauses.push({ OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: cutoff } }] });
  }
  if (f.replied) clauses.push({ repliedAt: { not: null } });
  if (f.noOutreach) clauses.push({ lastContactedAt: null });
  if (f.needsFollowUp) {
    clauses.push({ nextActionAt: { not: null, lte: new Date(now + 86_400_000) } });
  }

  // "Reachable" means a live, non-opted-out email or phone exists — whether or
  // not it has been revealed yet.
  if (f.reachable) {
    clauses.push({
      person: {
        contactMethods: {
          some: {
            kind: { in: ["WORK_EMAIL", "PERSONAL_EMAIL", "MOBILE", "DIRECT_PHONE"] },
            optedOutAt: null,
            status: { in: ["VERIFIED", "LIKELY"] },
          },
        },
      },
    });
  }

  if (clauses.length === 0) return base;
  return f.combine === "OR" ? { ...base, OR: clauses } : { ...base, AND: clauses };
}

/**
 * Every ordering ends on the id, so rows that tie on the sort key keep one
 * order between requests. Without it, Postgres may return ties in any order and
 * a lead can appear on two pages or on none.
 */
function buildOrderBy(f: Partial<LeadFilter>): Prisma.LeadOrderByWithRelationInput[] {
  return [...sortKeys(f), { id: "asc" }];
}

function sortKeys(f: Partial<LeadFilter>): Prisma.LeadOrderByWithRelationInput[] {
  const dir = (f.dir ?? "desc") as Prisma.SortOrder;
  switch (f.sort ?? "score") {
    case "surfaced":
      return [{ surfacedAt: dir }];
    case "activity":
      return [{ lastActivityAt: { sort: dir, nulls: "last" } }];
    case "value":
      return [{ estimatedBudgetInr: { sort: dir, nulls: "last" } }];
    case "name":
      return [{ person: { fullName: dir } }];
    case "company":
      return [{ company: { name: dir } }];
    case "intent":
      return [{ intent: dir }, { score: { composite: "desc" } }];
    case "score":
    default:
      // `composite` is a non-null Int, so no nulls ordering is needed here.
      return [{ score: { composite: dir } }, { surfacedAt: "desc" }];
  }
}

const LIST_SELECT = {
  id: true,
  status: true,
  tier: true,
  intent: true,
  isStarred: true,
  isRevealed: true,
  estimatedBudgetInr: true,
  surfacedAt: true,
  surfacedReason: true,
  lastContactedAt: true,
  lastActivityAt: true,
  repliedAt: true,
  nextActionAt: true,
  nextActionLabel: true,
  archivedAt: true,
  person: {
    select: {
      id: true,
      fullName: true,
      city: true,
      state: true,
      avatarUrl: true,
      linkedinUrl: true,
      employments: {
        where: { isCurrent: true },
        take: 1,
        select: { title: true, department: true, seniority: true, isDecisionMaker: true },
      },
      contactMethods: {
        select: { kind: true, isLocked: true, status: true, optedOutAt: true },
      },
    },
  },
  company: {
    select: {
      id: true,
      name: true,
      domain: true,
      logoUrl: true,
      industry: true,
      city: true,
      employeeCount: true,
      intentScore: true,
    },
  },
  score: {
    select: {
      displayScore: true,
      composite: true,
      overriddenScore: true,
      fitScore: true,
      intentScore: true,
      urgencyScore: true,
    },
  },
  owner: { select: { id: true, name: true, avatarUrl: true } },
  deals: {
    where: { deletedAt: null, status: "OPEN" as const },
    take: 1,
    select: { id: true, valueInr: true, stage: { select: { name: true, key: true } } },
  },
  signals: {
    take: 1,
    orderBy: { occurredAt: "desc" as const },
    select: { id: true, type: true, title: true, occurredAt: true, confidence: true },
  },
  _count: { select: { signals: true, conversations: true, tasks: true } },
} satisfies Prisma.LeadSelect;

export type LeadRow = ReturnType<typeof mapLeadRow>;

function mapLeadRow(lead: Prisma.LeadGetPayload<{ select: typeof LIST_SELECT }>) {
  const employment = lead.person.employments[0];
  const channels = deriveChannels(lead.person.contactMethods);

  return toPlain({
    id: lead.id,
    status: lead.status,
    tier: lead.tier,
    intent: lead.intent,
    isStarred: lead.isStarred,
    isRevealed: lead.isRevealed,
    isArchived: lead.archivedAt !== null,
    score: Number(lead.score?.overriddenScore ?? lead.score?.displayScore ?? 0),
    isScoreOverridden: lead.score?.overriddenScore != null,
    person: {
      id: lead.person.id,
      name: lead.person.fullName,
      avatarUrl: lead.person.avatarUrl,
      linkedinUrl: lead.person.linkedinUrl,
      location: [lead.person.city, lead.person.state].filter(Boolean).join(", "),
      title: employment?.title ?? "—",
      department: employment?.department ?? null,
      seniority: employment?.seniority ?? null,
      isDecisionMaker: employment?.isDecisionMaker ?? false,
    },
    company: {
      id: lead.company.id,
      name: lead.company.name,
      domain: lead.company.domain,
      logoUrl: lead.company.logoUrl,
      industry: lead.company.industry,
      city: lead.company.city,
      employeeCount: lead.company.employeeCount,
      intentScore: lead.company.intentScore,
    },
    channels,
    owner: lead.owner,
    estimatedBudgetInr: lead.estimatedBudgetInr,
    surfacedAt: lead.surfacedAt,
    surfacedReason: lead.surfacedReason,
    lastContactedAt: lead.lastContactedAt,
    lastActivityAt: lead.lastActivityAt,
    repliedAt: lead.repliedAt,
    nextActionAt: lead.nextActionAt,
    nextActionLabel: lead.nextActionLabel,
    deal: lead.deals[0]
      ? {
          id: lead.deals[0].id,
          valueInr: lead.deals[0].valueInr,
          stage: lead.deals[0].stage.name,
          stageKey: lead.deals[0].stage.key,
        }
      : null,
    latestSignal: lead.signals[0] ?? null,
    counts: {
      signals: lead._count.signals,
      conversations: lead._count.conversations,
      tasks: lead._count.tasks,
    },
  });
}

function deriveChannels(methods: { kind: string; isLocked: boolean; status: string; optedOutAt: Date | null }[]) {
  const live = methods.filter((m) => !m.optedOutAt && m.status !== "FAILED");
  const has = (kinds: string[]) => live.filter((m) => kinds.includes(m.kind));
  const email = has(["WORK_EMAIL", "PERSONAL_EMAIL"]);
  const phone = has(["MOBILE", "DIRECT_PHONE"]);
  const linkedin = has(["LINKEDIN_URL"]);

  return {
    email: channelState(email),
    phone: channelState(phone),
    whatsapp: channelState(phone),
    linkedin: channelState(linkedin),
    optedOut: methods.some((m) => m.optedOutAt !== null),
  };
}

function channelState(methods: { isLocked: boolean; status: string }[]): "open" | "locked" | "none" {
  if (methods.length === 0) return "none";
  return methods.some((m) => !m.isLocked) ? "open" : "locked";
}

export async function listLeads(ctx: AuthContext, filter: LeadFilter) {
  const where = buildWhere(ctx, filter);
  const [rows, total] = await Promise.all([
    db.lead.findMany({
      where,
      select: LIST_SELECT,
      orderBy: buildOrderBy(filter),
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    }),
    db.lead.count({ where }),
  ]);

  return {
    rows: rows.map(mapLeadRow),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
    pageCount: Math.max(1, Math.ceil(total / filter.pageSize)),
  };
}

/** Live counts behind every smart shortcut chip. */
export async function getShortcutCounts(ctx: AuthContext): Promise<Record<string, number>> {
  const results = await Promise.all(
    SHORTCUTS.map((s) => db.lead.count({ where: buildWhere(ctx, { ...s.filter, combine: "AND" }) }))
  );
  return Object.fromEntries(SHORTCUTS.map((s, i) => [s.key, results[i]]));
}

/** Distinct values for the filter builder's dropdowns. */
export async function getFilterFacets(ctx: AuthContext) {
  const [industries, cities, states, owners, lists, signalTypes, technologies] = await Promise.all([
    db.company.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, industry: { not: null } },
      distinct: ["industry"],
      select: { industry: true },
      orderBy: { industry: "asc" },
    }),
    db.company.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, city: { not: null } },
      distinct: ["city"],
      select: { city: true },
      orderBy: { city: "asc" },
    }),
    db.company.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, state: { not: null } },
      distinct: ["state"],
      select: { state: true },
      orderBy: { state: "asc" },
    }),
    db.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    db.list.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, name: true, isDynamic: true, _count: { select: { members: true } } },
      orderBy: { name: "asc" },
    }),
    db.signal.findMany({
      where: { workspaceId: ctx.workspaceId },
      distinct: ["type"],
      select: { type: true },
    }),
    db.company.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: { technologies: true, tags: true, country: true },
    }),
  ]);
  // Offered from what is stored, so every option can match something. The list
  // used to be hard-coded ("c-level") while titles are stored as "c_level".
  const seniorities = await db.employment.findMany({
    where: { workspaceId: ctx.workspaceId, isCurrent: true, seniority: { not: null } },
    distinct: ["seniority"],
    select: { seniority: true },
    orderBy: { seniority: "asc" },
  });
  const sourceKinds = await db.signal.findMany({ where: { workspaceId: ctx.workspaceId, deletedAt: null }, distinct: ["sourceKind"], select: { sourceKind: true } });

  return {
    industries: industries.map((i) => i.industry!).filter(Boolean),
    cities: cities.map((c) => c.city!).filter(Boolean),
    states: states.map((s) => s.state!).filter(Boolean),
    owners: owners.map((o) => o.user),
    lists: lists.map((l) => ({ id: l.id, name: l.name, isDynamic: l.isDynamic, count: l._count.members })),
    signalTypes: signalTypes.map((s) => s.type),
    technologies: [...new Set(technologies.flatMap((t) => t.technologies))].sort(),
    tags: [...new Set(technologies.flatMap((t) => t.tags))].sort(),
    countries: [...new Set(technologies.map((t) => t.country).filter((c): c is string => Boolean(c)))].sort(),
    sources: sourceKinds.map((s) => s.sourceKind),
    seniorities: seniorities.map((s) => s.seniority!).filter(Boolean),
    departments: [
      "Executive", "Technology", "Finance", "Operations", "Sales", "Marketing", "Procurement",
    ],
  };
}
