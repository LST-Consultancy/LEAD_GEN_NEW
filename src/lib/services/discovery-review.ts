import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { opportunityReadPermission } from "./opportunities";
import { mutate, loadScoped, MutationError } from "./mutate";
import { toPlain } from "@/lib/serialize";
import { ingestOpportunity } from "./opportunity-ingestion";
import { criteriaSchema } from "@/lib/opportunities/query-parser";
import type { SourceDocument } from "@/lib/opportunities/extractor";
import { checkFilters } from "@/lib/opportunities/linkedin-qualify";
import { resolveOptions } from "@/lib/opportunities/linkedin-plan";
import { providerConfigSchema } from "@/lib/providers/discovery";
import { processLinkedInDocs, readCheckpoint, saveProviderCheckpoint } from "./linkedin-discovery";
import type { Prisma } from "@/generated/prisma/client";

const listSchema = z.object({ searchId: z.string().uuid().optional(), status: z.enum(["REVIEW", "REJECTED"]).default("REVIEW"), reason: z.string().max(40).regex(/^[a-z_]+$/).optional() });
export async function listDiscoveryCandidates(ctx: AuthContext, rawOrSearchId?: unknown) {
  opportunityReadPermission(ctx);
  // Tolerant: a hand-edited URL with a bad status or reason shows the default list, not an error.
  const raw = typeof rawOrSearchId === "string" ? { searchId: rawOrSearchId } : rawOrSearchId ?? {};
  if (typeof (raw as { searchId?: unknown }).searchId === "string") z.string().uuid().parse((raw as { searchId: string }).searchId);
  const parsed = listSchema.safeParse(raw);
  const f = parsed.success ? parsed.data : { status: "REVIEW" as const, searchId: (raw as { searchId?: string }).searchId };
  return toPlain(await db.discoveryCandidate.findMany({ where: { workspaceId: ctx.workspaceId, status: f.status, expiresAt: { gt: new Date() }, ...(f.searchId ? { searchId: f.searchId } : {}), ...("reason" in f && f.reason ? { reason: f.reason } : {}) }, select: { id: true, searchId: true, sourceUrl: true, title: true, description: true, kind: true, postedAt: true, createdAt: true, provider: true, status: true, reason: true, classification: true, evidence: true, processing: true, suggestedBuyer: true }, orderBy: { createdAt: "desc" }, take: 100 }));
}

/** Counts per reason, so the review screen can offer a filter for each without loading every row. */
export async function discoveryReasonCounts(ctx: AuthContext, searchId?: string) {
  opportunityReadPermission(ctx);
  if (searchId) z.string().uuid().parse(searchId);
  const rows = await db.discoveryCandidate.groupBy({ by: ["status", "reason"], where: { workspaceId: ctx.workspaceId, status: { in: ["REVIEW", "REJECTED"] }, expiresAt: { gt: new Date() }, ...(searchId ? { searchId } : {}) }, _count: { _all: true } });
  return rows.map(r => ({ status: r.status, reason: r.reason, count: r._count._all }));
}

const reviewSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("dismiss") }), z.object({ action: z.literal("qualify"), company: z.string().trim().min(2).max(200), domain: z.string().trim().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i).optional(), country: z.string().trim().max(100).optional() })]);
export async function reviewDiscoveryCandidate(ctx: AuthContext, id: string, raw: unknown) {
  z.string().uuid().parse(id);
  const input = reviewSchema.parse(raw);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const candidate = await loadScoped(() => db.discoveryCandidate.findFirst({ where: { id, workspaceId: ctx.workspaceId, expiresAt: { gt: new Date() } }, include: { search: true } }), "That discovery match");
    // A rejected post can be overridden by a person; a settled one is returned as it is.
    if (candidate.status !== "REVIEW" && candidate.status !== "REJECTED") return { result: { opportunityId: candidate.opportunityId, status: candidate.status }, log: { action: "discovery.reviewed", objectType: "DiscoveryCandidate", objectId: id } };
    let opportunityId: string | null = null;
    if (input.action === "qualify") {
      const connection = await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: candidate.provider } } });
      if (!connection?.enabled || !connection.allowedStorage) throw new MutationError("This source is disabled or no longer permits storage.", "source_unavailable", 422);
      const doc = candidate.document as unknown as SourceDocument;
      const criteria = criteriaSchema.parse(candidate.search.criteria);
      const confirmed: SourceDocument = { ...doc, company: { ...doc.company, name: input.company, domain: input.domain, country: input.country }, rawSourceReference: { ...doc.rawSourceReference, buyerConfirmedBy: ctx.userId, buyerConfirmedAt: new Date().toISOString() } };
      const policy = { allowedExport: connection.allowedExport, retentionDays: Math.max(1, Math.ceil((candidate.expiresAt.getTime() - Date.now()) / 86400000)) };
      let result: Awaited<ReturnType<typeof ingestOpportunity>>;
      if (candidate.classification) {
        // A person has confirmed the buyer, so what is still unknown is accepted — and recorded as
        // unknown, not as a match. A known conflict with the search's filters is still refused.
        const filters = checkFilters(confirmed, criteria);
        const mismatch = filters.find(f => f.state === "mismatch");
        if (mismatch) throw new MutationError(`The ${mismatch.field} you entered (${mismatch.value}) does not match this search, which asks for ${mismatch.wanted}. Dismiss it, or search again without that filter.`, "not_qualified", 422);
        const postedAt = doc.postedAt ? Date.parse(doc.postedAt) : null;
        if (postedAt !== null && postedAt < Date.now() - criteria.dateRange.days * 86400000 - 86400000) throw new MutationError(`This post is older than the search's ${criteria.dateRange.days}-day window.`, "not_qualified", 422);
        result = await ingestOpportunity(ctx.workspaceId, candidate.searchId, { ...confirmed, rawSourceReference: { ...confirmed.rawSourceReference, qualification: { confirmedByReviewer: true, overrodeRejection: candidate.status === "REJECTED" ? candidate.reason : null, filters } } }, criteria, policy, new Date(), { assessed: true });
      } else {
        result = await ingestOpportunity(ctx.workspaceId, candidate.searchId, confirmed, criteria, policy);
      }
      if (!result) throw new MutationError("This match does not contain a qualifying requirement or does not meet the search filters. Review the source evidence before qualifying.", "not_qualified", 422);
      opportunityId = result.id;
    }
    const status = input.action === "dismiss" ? "DISMISSED" : "QUALIFIED";
    await db.discoveryCandidate.update({ where: { id, workspaceId: ctx.workspaceId }, data: { status, opportunityId, processing: "DONE" } });
    return { result: { opportunityId, status }, log: { action: "discovery.reviewed", objectType: "DiscoveryCandidate", objectId: id, before: { status: candidate.status, reason: candidate.reason }, after: { status, opportunityId } } };
  });
}

const RETRY_BATCH = 20;
/**
 * Re-runs the buyer check for posts that were kept because the AI could not run. The posts go
 * through the same rules as during the search, so a retry can qualify, keep in review, or reject.
 */
export async function retryDiscoveryAttribution(ctx: AuthContext, searchId: string) {
  z.string().uuid().parse(searchId);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const search = await loadScoped(() => db.opportunitySearch.findFirst({ where: { id: searchId, workspaceId: ctx.workspaceId } }), "That search");
    const pending = await db.discoveryCandidate.findMany({ where: { workspaceId: ctx.workspaceId, searchId, status: "REVIEW", processing: "RETRY_PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "asc" }, take: RETRY_BATCH });
    if (!pending.length) return { result: { attempted: 0, outcomes: {}, remaining: 0 }, log: { action: "discovery.retried", objectType: "OpportunitySearch", objectId: searchId } };
    const provider = pending[0].provider;
    const connection = await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider } } });
    if (!connection?.enabled || !connection.allowedStorage) throw new MutationError("This source is disabled or no longer permits storage, so nothing was retried.", "source_unavailable", 422);
    const options = resolveOptions(search.options, providerConfigSchema.parse(connection.config).maxPostsPerSearch);
    const docs = pending.map(c => c.document as unknown as SourceDocument);
    const labels = await processLinkedInDocs({ workspaceId: ctx.workspaceId, searchId, criteria: criteriaSchema.parse(search.criteria), strict: options.strictFilters, policy: { allowedExport: connection.allowedExport, retentionDays: connection.retentionDays }, runStartedAt: search.startedAt ?? search.createdAt, now: new Date() }, docs, { keyword: "", page: 0 });
    const outcomes: Record<string, number> = {};
    for (const l of labels) outcomes[l] = (outcomes[l] ?? 0) + 1;
    // The run's own funnel describes the run; a retry afterwards is recorded beside it, not folded in.
    const retries = readCheckpoint(search.checkpoint).providers?.[provider]?.retries ?? [];
    await saveProviderCheckpoint(ctx.workspaceId, searchId, provider, { retries: [...retries, { at: new Date().toISOString(), attempted: pending.length, outcomes }].slice(-20) });
    const qualified = await db.opportunitySearchResult.count({ where: { workspaceId: ctx.workspaceId, searchId } });
    await db.opportunitySearch.update({ where: { id: searchId, workspaceId: ctx.workspaceId }, data: { qualified } });
    const remaining = await db.discoveryCandidate.count({ where: { workspaceId: ctx.workspaceId, searchId, status: "REVIEW", processing: "RETRY_PENDING", expiresAt: { gt: new Date() } } });
    return { result: { attempted: pending.length, outcomes, remaining }, log: { action: "discovery.retried", objectType: "OpportunitySearch", objectId: searchId, after: { attempted: pending.length, outcomes } as Prisma.InputJsonValue } };
  });
}
