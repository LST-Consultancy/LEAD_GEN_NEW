import "server-only";
import { DISCOVERY_PROVIDERS } from "@/lib/providers/opportunity-source";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, assertPermission } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { mutate, MutationError, loadScoped } from "./mutate";
import { toPlain } from "@/lib/serialize";
import { parseOpportunityQuery, criteriaSchema, opportunityTypes } from "@/lib/opportunities/query-parser";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";
import { isQueueConfigured } from "@/lib/queue/connection";
import { rateLimit } from "@/lib/security/rate-limit";
import type { Prisma } from "@/generated/prisma/client";

export function opportunityReadPermission(ctx: AuthContext) {
  if (!ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL)) assertPermission(ctx, PERMISSIONS.LEADS_VIEW_OWN);
}
// Company opportunity evidence is workspace intelligence, like existing company signals.
export const searchInputSchema = z.object({ query: z.string().trim().min(3).max(2000), providers: z.array(z.enum(DISCOVERY_PROVIDERS)).min(1).max(5), criteria: criteriaSchema.optional(), idempotencyKey: z.string().uuid() });
export async function startOpportunitySearch(ctx: AuthContext, raw: unknown) {
  assertPermission(ctx, PERMISSIONS.LEADS_EDIT);
  const input = searchInputSchema.parse(raw);
  if (!isQueueConfigured()) throw new MutationError("Opportunity discovery needs Redis and the worker. No search was started or charged.", "queue_unavailable", 503);
  const limit = await rateLimit("write", `opportunity-search:${ctx.workspaceId}`, { limit: 10, windowSeconds: 60 });
  if (!limit.allowed || limit.degraded) throw new MutationError("Search limit reached or shared limiter unavailable. Try again later.", "rate_limited", 429);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const criteria = input.criteria ?? parseOpportunityQuery(input.query);
    const search = await db.opportunitySearch.upsert({ where: { workspaceId_idempotencyKey: { workspaceId: ctx.workspaceId, idempotencyKey: input.idempotencyKey } }, create: { workspaceId: ctx.workspaceId, createdById: ctx.userId, query: input.query, providers: input.providers, criteria, idempotencyKey: input.idempotencyKey }, update: {} });
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
  return toPlain(await loadScoped(() => db.opportunitySearch.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That search"));
}
export async function opportunityPeople(ctx: AuthContext, companyId: string) {
  opportunityReadPermission(ctx);
  // Respect existing lead ownership before exposing person/contact records.
  const rows = await db.employment.findMany({ where: { workspaceId: ctx.workspaceId, companyId, isCurrent: true, isDecisionMaker: true, person: { workspaceId: ctx.workspaceId, deletedAt: null, ...(ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL) ? {} : { leads: { some: { workspaceId: ctx.workspaceId, ownerId: ctx.userId, deletedAt: null } } }) } }, include: { person: { include: { contactMethods: { where: { workspaceId: ctx.workspaceId, isLocked: false, optedOutAt: null } } } } }, take: 20 });
  const suppressed = await db.suppression.findMany({ where: { workspaceId: ctx.workspaceId }, select: { value: true } });
  const blocked = new Set(suppressed.map(s => s.value.toLowerCase()));
  return toPlain(rows.map(e => ({ ...e, person: { ...e.person, contactMethods: e.person.contactMethods.filter(c => !c.value || !blocked.has(c.value.toLowerCase())) } } )));
}
export async function saveOpportunitySearch(ctx: AuthContext, raw: unknown) {
  const input = z.object({ name: z.string().trim().min(2).max(80), criteria: criteriaSchema.optional(), query: z.string().min(3).max(2000), providers: z.array(z.enum(DISCOVERY_PROVIDERS)).min(1), cadenceHours: z.union([z.literal(6), z.literal(24), z.literal(72), z.literal(168)]).default(24) }).parse(raw);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const saved = await db.savedSearch.create({ data: { workspaceId: ctx.workspaceId, createdById: ctx.userId, name: input.name, surface: "opportunities", filterJson: input, alertEnabled: true, frequency: input.cadenceHours === 168 ? "WEEKLY" : "DAILY" } });
    return { result: toPlain(saved), log: { action: "opportunity.watch", objectType: "SavedSearch", objectId: saved.id, after: { name: saved.name } } };
  });
}
