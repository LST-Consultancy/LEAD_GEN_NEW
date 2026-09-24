import "server-only";
import { DISCOVERY_PROVIDERS } from "@/lib/providers/opportunity-source";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, assertPermission, leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { mutate, MutationError, loadScoped } from "./mutate";
import { toPlain } from "@/lib/serialize";
import { parseOpportunityQuery, criteriaSchema, opportunityTypes } from "@/lib/opportunities/query-parser";
import { enqueue, getJobOutcome } from "@/lib/queue/producer";
import { judgeSearchJob } from "@/lib/opportunities/search-status";
import { failOpportunitySearch } from "./opportunity-ingestion";
import { readCheckpoint } from "./linkedin-discovery";
import { discoveryOptionsSchema } from "@/lib/opportunities/linkedin-plan";
import { JOB } from "@/lib/queue/jobs";
import { isQueueConfigured } from "@/lib/queue/connection";
import { rateLimit } from "@/lib/security/rate-limit";
import type { Prisma } from "@/generated/prisma/client";

export function opportunityReadPermission(ctx: AuthContext) {
  if (!ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL)) assertPermission(ctx, PERMISSIONS.LEADS_VIEW_OWN);
}
// Company opportunity evidence is workspace intelligence, like existing company signals.
export const searchInputSchema = z.object({ query: z.string().trim().min(3).max(2000), providers: z.array(z.enum(DISCOVERY_PROVIDERS)).min(1).max(5), criteria: criteriaSchema.optional(), options: discoveryOptionsSchema.optional(), idempotencyKey: z.string().uuid() });
export async function startOpportunitySearch(ctx: AuthContext, raw: unknown) {
  assertPermission(ctx, PERMISSIONS.LEADS_EDIT);
  const input = searchInputSchema.parse(raw);
  if (!isQueueConfigured()) throw new MutationError("Opportunity discovery needs Redis and the worker. No search was started or charged.", "queue_unavailable", 503);
  const limit = await rateLimit("write", `opportunity-search:${ctx.workspaceId}`, { limit: 10, windowSeconds: 60 });
  if (!limit.allowed || limit.degraded) throw new MutationError("Search limit reached or shared limiter unavailable. Try again later.", "rate_limited", 429);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const criteria = input.criteria ?? parseOpportunityQuery(input.query);
    const search = await db.opportunitySearch.upsert({ where: { workspaceId_idempotencyKey: { workspaceId: ctx.workspaceId, idempotencyKey: input.idempotencyKey } }, create: { workspaceId: ctx.workspaceId, createdById: ctx.userId, query: input.query, providers: input.providers, criteria, options: input.options ?? {}, idempotencyKey: input.idempotencyKey }, update: {} });
    if (search.state === "QUEUED") {
      const queued = await enqueue(JOB.OPPORTUNITY_DISCOVERY, { workspaceId: ctx.workspaceId, searchId: search.id }, { dedupeKey: search.id, dedupeWindowSec: 0 });
      if (!queued.queued) { await db.opportunitySearch.update({ where: { id: search.id, workspaceId: ctx.workspaceId }, data: { state: "FAILED", error: queued.detail, finishedAt: new Date() } }); throw new MutationError(queued.detail, "queue_unavailable", 503); }
    }
    return { result: toPlain(search), log: { action: "opportunity.search", objectType: "OpportunitySearch", objectId: search.id, after: { providers: input.providers } } };
  });
}
export const opportunityFilterSchema = z.object({
  q: z.string().max(200).optional(), searchId: z.string().uuid().optional(), companyId: z.string().uuid().optional(),
  intent: z.coerce.number().min(0).max(100).optional(), fit: z.coerce.number().min(0).max(100).optional(), score: z.coerce.number().min(0).max(100).optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(), discoveredDays: z.coerce.number().int().min(1).max(3650).optional(), updatedDays: z.coerce.number().int().min(1).max(3650).optional(),
  type: z.enum(opportunityTypes).optional(), source: z.string().max(80).optional(), location: z.string().max(100).optional(), industry: z.string().max(100).optional(), technology: z.string().max(80).optional(),
  employeeMin: z.coerce.number().int().nonnegative().optional(), employeeMax: z.coerce.number().int().positive().optional(), status: z.enum(["NEW", "ACTIVE", "AGING", "CLOSED", "EXPIRED", "PAUSED", "OPEN", "AWARDED", "CANCELLED", "UNKNOWN"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export async function listOpportunities(ctx: AuthContext, raw: unknown = {}) {
  opportunityReadPermission(ctx);
  const cleaned = raw && typeof raw === "object" ? Object.fromEntries(Object.entries(raw).filter(([,v])=>v !== "")) : raw;
  const f = opportunityFilterSchema.parse(cleaned);
  const since = (days: number) => new Date(Date.now() - days * 86400000);
  const where: Prisma.OpportunityWhereInput = { workspaceId: ctx.workspaceId, deletedAt: null,
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { service: { contains: f.q, mode: "insensitive" } }, { company: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
    ...(f.searchId ? { results: { some: { workspaceId: ctx.workspaceId, searchId: f.searchId } } } : {}), ...(f.companyId ? { companyId: f.companyId } : {}),
    intentScore: { gte: f.intent ?? 0 }, fitScore: { gte: f.fit ?? 0 }, opportunityScore: { gte: f.score ?? 0 },
    ...(f.days ? { postedAt: { gte: since(f.days), lte: new Date() } } : {}), ...(f.discoveredDays ? { discoveredAt: { gte: since(f.discoveredDays) } } : {}), ...(f.updatedDays ? { updatedAt: { gte: since(f.updatedDays) } } : {}),
    ...(f.type ? { types: { has: f.type } } : {}), ...(f.status ? { status: f.status } : {}), ...(f.technology ? { technologies: { has: f.technology } } : {}),
    ...(f.source ? { sources: { some: { workspaceId: ctx.workspaceId, provider: f.source } } } : {}), ...(f.location ? { location: { contains: f.location, mode: "insensitive" } } : {}),
    company: { workspaceId: ctx.workspaceId, deletedAt: null, ...(f.industry ? { industry: { contains: f.industry, mode: "insensitive" } } : {}), ...(f.employeeMin || f.employeeMax ? { employeeCount: { gte: f.employeeMin, lte: f.employeeMax } } : {}) },
  };
  const [total, items] = await Promise.all([db.opportunity.count({ where }), db.opportunity.findMany({ where, include: { company: true, sources: { where: { workspaceId: ctx.workspaceId }, select: { provider: true, sourceUrl: true, allowedExport: true, postedAt: true } } }, orderBy: [{ activeRank: "desc" }, { intentScore: "desc" }, { postedAt: { sort: "desc", nulls: "last" } }, { fitScore: "desc" }], take: 50, skip: (f.page - 1) * 50 })]);
  return toPlain({ total, items, page: f.page });
}
export async function getOpportunity(ctx: AuthContext, id: string) {
  z.string().uuid().parse(id);
  opportunityReadPermission(ctx);
  return toPlain(await loadScoped(() => db.opportunity.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null, company: { deletedAt: null } }, include: { company: true, sources: { where: { workspaceId: ctx.workspaceId } }, evidence: { where: { workspaceId: ctx.workspaceId } }, versions: { where: { workspaceId: ctx.workspaceId }, orderBy: { changedAt: "desc" } } } }), "That opportunity"));
}
export async function getOpportunitySearch(ctx: AuthContext, id: string) {
  z.string().uuid().parse(id);
  opportunityReadPermission(ctx);
  const find = () => db.opportunitySearch.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  let search = await loadScoped(find, "That search");
  let notice: string | null = null;
  // The row alone cannot tell "waiting" from "its job died": a dead job never writes back.
  if (search.state === "QUEUED" || search.state === "RUNNING") {
    const verdict = judgeSearchJob(await getJobOutcome(jobKeyOf(search)), search.createdAt, new Date());
    if (verdict && "fail" in verdict) { await failOpportunitySearch(ctx.workspaceId, search.id, verdict.fail); search = await loadScoped(find, "That search"); }
    else if (verdict) notice = verdict.notice;
  }
  // Same filter as listDiscoveryCandidates, so the count matches the review screen it links to.
  const live = { workspaceId: ctx.workspaceId, searchId: search.id, expiresAt: { gt: new Date() } };
  const [needsReview, rejected, retryPending] = await Promise.all([
    db.discoveryCandidate.count({ where: { ...live, status: "REVIEW" } }),
    db.discoveryCandidate.count({ where: { ...live, status: "REJECTED" } }),
    db.discoveryCandidate.count({ where: { ...live, status: "REVIEW", processing: "RETRY_PENDING" } }),
  ]);
  // CRM conversion is reported beside discovery, not inside it: a lead exists only once a person
  // chose a contact and converted the opportunity, which opportunityToCrm records as a signal
  // carrying the source URL. Counted through the reader's own lead visibility.
  const urls = (await db.opportunitySource.findMany({ where: { workspaceId: ctx.workspaceId, opportunity: { workspaceId: ctx.workspaceId, results: { some: { workspaceId: ctx.workspaceId, searchId: search.id } } } }, select: { sourceUrl: true }, take: 2000 })).map(r => r.sourceUrl);
  const crmLeads = urls.length ? (await db.signal.findMany({ where: { workspaceId: ctx.workspaceId, sourceUrl: { in: urls }, lead: { workspaceId: ctx.workspaceId, deletedAt: null, ...leadVisibilityFilter(ctx) } }, select: { leadId: true }, distinct: ["leadId"] })).length : 0;
  const { checkpoint, ...rest } = search;
  const retries = readCheckpoint(checkpoint).providers?.linkedin_posts?.retries ?? [];
  return toPlain({ ...rest, notice, needsReview, rejected, retryPending, crmLeads, retries, resumable: resumableReason(search) === null });
}

const jobKeyOf = (search: { id: string; checkpoint: unknown }) => { const k = (readCheckpoint(search.checkpoint) as { jobKey?: unknown }).jobKey; return typeof k === "string" ? k : search.id; };
const RESUMABLE_STOPS = new Set(["cancelled", "rate_limited", "provider_error", "budget_runtime"]);
/** Null when the search can continue from its checkpoint; otherwise the sentence saying why not. */
function resumableReason(search: { state: string; checkpoint: unknown }): string | null {
  if (!["PARTIAL", "CANCELLED", "FAILED"].includes(search.state)) return "Only a stopped or partly completed search can be resumed.";
  const run = readCheckpoint(search.checkpoint).providers?.linkedin_posts?.run;
  if (!run?.stop || !RESUMABLE_STOPS.has(run.stop)) return "This search stopped because it finished, reached its target or used its post budget. Start a new search with more depth instead.";
  return null;
}

/**
 * Stops a search between pages. A page already running at the provider finishes and is kept,
 * because it has already been charged; nothing after it starts.
 */
export async function cancelOpportunitySearch(ctx: AuthContext, id: string) {
  z.string().uuid().parse(id);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const search = await loadScoped(() => db.opportunitySearch.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That search");
    if (search.finishedAt) return { result: { state: search.state, note: "This search had already finished." }, log: { action: "opportunity.search_cancelled", objectType: "OpportunitySearch", objectId: id } };
    const now = new Date();
    // A search the worker has not picked up yet can finish here; a running one stops at its next page.
    const { count } = await db.opportunitySearch.updateMany({ where: { id, workspaceId: ctx.workspaceId, state: "QUEUED", finishedAt: null }, data: { state: "CANCELLED", cancelRequestedAt: now, finishedAt: now, progress: 100 } });
    if (!count) await db.opportunitySearch.updateMany({ where: { id, workspaceId: ctx.workspaceId, finishedAt: null }, data: { cancelRequestedAt: now } });
    return { result: { state: count ? "CANCELLED" : "RUNNING", note: count ? "Cancelled before it started. Nothing was searched or charged." : "Stopping after the page in progress. Posts already retrieved are kept." }, log: { action: "opportunity.search_cancelled", objectType: "OpportunitySearch", objectId: id, after: { requestedAt: now.toISOString() } } };
  });
}

/** Continues a stopped LinkedIn run from its checkpoint: finished pages are not fetched or charged again. */
export async function resumeOpportunitySearch(ctx: AuthContext, id: string) {
  z.string().uuid().parse(id);
  assertPermission(ctx, PERMISSIONS.LEADS_EDIT);
  if (!isQueueConfigured()) throw new MutationError("Resuming needs Redis and the worker. Nothing was started or charged.", "queue_unavailable", 503);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const search = await loadScoped(() => db.opportunitySearch.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That search");
    const refusal = resumableReason(search);
    if (refusal) throw new MutationError(refusal, "not_resumable", 409);
    const jobKey = `${id}-resume-${Date.now()}`;
    const { count } = await db.opportunitySearch.updateMany({ where: { id, workspaceId: ctx.workspaceId, state: search.state, finishedAt: { not: null } }, data: { state: "QUEUED", progress: 10, finishedAt: null, cancelRequestedAt: null, error: null, checkpoint: { ...readCheckpoint(search.checkpoint), jobKey } as Prisma.InputJsonValue } });
    if (!count) throw new MutationError("This search changed while you were looking at it. Refresh and try again.", "conflict", 409);
    const queued = await enqueue(JOB.OPPORTUNITY_DISCOVERY, { workspaceId: ctx.workspaceId, searchId: id }, { dedupeKey: jobKey, dedupeWindowSec: 0 });
    if (!queued.queued) { await db.opportunitySearch.update({ where: { id, workspaceId: ctx.workspaceId }, data: { state: search.state, finishedAt: new Date(), error: queued.detail } }); throw new MutationError(queued.detail, "queue_unavailable", 503); }
    return { result: { state: "QUEUED" }, log: { action: "opportunity.search_resumed", objectType: "OpportunitySearch", objectId: id } };
  });
}
export async function opportunityPeople(ctx: AuthContext, companyId: string) {
  opportunityReadPermission(ctx);
  // Respect existing lead ownership before exposing person/contact records.
  const rows = await db.employment.findMany({ where: { workspaceId: ctx.workspaceId, companyId, isCurrent: true, person: { workspaceId: ctx.workspaceId, deletedAt: null, ...(ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL) ? {} : { leads: { some: { workspaceId: ctx.workspaceId, ownerId: ctx.userId, deletedAt: null } } }) } }, include: { person: { include: { contactMethods: { where: { workspaceId: ctx.workspaceId, isLocked: false, optedOutAt: null } } } } }, orderBy: [{ isDecisionMaker: "desc" }, { createdAt: "asc" }], take: 30 });
  const suppressed = await db.suppression.findMany({ where: { workspaceId: ctx.workspaceId }, select: { value: true } });
  const blocked = new Set(suppressed.map(s => s.value.toLowerCase()));
  return toPlain(rows.map(e => ({ ...e, person: { ...e.person, contactMethods: e.person.contactMethods.filter(c => !c.value || !blocked.has(c.value.toLowerCase())) } } )));
}
export async function saveOpportunitySearch(ctx: AuthContext, raw: unknown) {
  const input = z.object({ name: z.string().trim().min(2).max(80), criteria: criteriaSchema.optional(), options: discoveryOptionsSchema.optional(), query: z.string().min(3).max(2000), providers: z.array(z.enum(DISCOVERY_PROVIDERS)).min(1), cadenceHours: z.union([z.literal(6), z.literal(24), z.literal(72), z.literal(168)]).default(24) }).parse(raw);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const saved = await db.savedSearch.create({ data: { workspaceId: ctx.workspaceId, createdById: ctx.userId, name: input.name, surface: "opportunities", filterJson: input, alertEnabled: true, frequency: input.cadenceHours === 168 ? "WEEKLY" : "DAILY" } });
    return { result: toPlain(saved), log: { action: "opportunity.watch", objectType: "SavedSearch", objectId: saved.id, after: { name: saved.name } } };
  });
}

/**
 * Active demand by kind of work: how many ACTIVE opportunities (the same
 * status the Live Demand table and the linked list filter on), at how many
 * companies, ask for each type. An opportunity can carry several types, so the
 * rows can sum to more than the total — the total is reported separately.
 */
export async function getDemandByType(ctx: AuthContext) {
  opportunityReadPermission(ctx);
  const rows = await db.opportunity.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "ACTIVE" },
    select: { types: true, companyId: true },
    take: 5000,
  });
  const byType = new Map<string, { opportunities: number; companies: Set<string> }>();
  for (const r of rows) {
    for (const t of r.types.length ? r.types : ["UNKNOWN" as const]) {
      const e = byType.get(t) ?? { opportunities: 0, companies: new Set<string>() };
      e.opportunities++; e.companies.add(r.companyId); byType.set(t, e);
    }
  }
  return {
    total: rows.length,
    capped: rows.length === 5000,
    types: [...byType.entries()].map(([type, e]) => ({ type, opportunities: e.opportunities, companies: e.companies.size })).sort((a, b) => b.opportunities - a.opportunities),
  };
}
