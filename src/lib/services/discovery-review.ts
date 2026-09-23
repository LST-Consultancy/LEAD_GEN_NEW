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
export async function listDiscoveryCandidates(ctx: AuthContext, searchId?: string) {
  opportunityReadPermission(ctx);
  if (searchId) z.string().uuid().parse(searchId);
  return toPlain(await db.discoveryCandidate.findMany({ where: { workspaceId: ctx.workspaceId, status: "REVIEW", expiresAt: { gt: new Date() }, ...(searchId ? { searchId } : {}) }, select: { id: true, sourceUrl: true, title: true, description: true, kind: true, postedAt: true, createdAt: true, provider: true }, orderBy: { createdAt: "desc" }, take: 100 }));
}
const reviewSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("dismiss") }), z.object({ action: z.literal("qualify"), company: z.string().trim().min(2).max(200), domain: z.string().trim().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i).optional(), country: z.string().trim().max(100).optional() })]);
export async function reviewDiscoveryCandidate(ctx: AuthContext, id: string, raw: unknown) {
  z.string().uuid().parse(id);
  const input = reviewSchema.parse(raw);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const candidate = await loadScoped(() => db.discoveryCandidate.findFirst({ where: { id, workspaceId: ctx.workspaceId, expiresAt: { gt: new Date() } }, include: { search: true } }), "That discovery match");
    if (candidate.status !== "REVIEW") return { result: { opportunityId: candidate.opportunityId, status: candidate.status }, log: { action: "discovery.reviewed", objectType: "DiscoveryCandidate", objectId: id } };
    let opportunityId: string | null = null;
    if (input.action === "qualify") {
      const connection = await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: candidate.provider } } });
      if (!connection?.enabled || !connection.allowedStorage) throw new MutationError("This source is disabled or no longer permits storage.", "source_unavailable", 422);
      const doc = candidate.document as unknown as SourceDocument;
      const result = await ingestOpportunity(ctx.workspaceId, candidate.searchId, { ...doc, company: { name: input.company, domain: input.domain, country: input.country }, rawSourceReference: { ...doc.rawSourceReference, buyerConfirmedBy: ctx.userId, buyerConfirmedAt: new Date().toISOString() } }, criteriaSchema.parse(candidate.search.criteria), { allowedExport: connection.allowedExport, retentionDays: Math.max(1, Math.ceil((candidate.expiresAt.getTime() - Date.now()) / 86400000)) });
      if (!result) throw new MutationError("This match does not contain a qualifying requirement or does not meet the search filters. Review the source evidence before qualifying.", "not_qualified", 422);
      opportunityId = result.id;
    }
    const status = input.action === "dismiss" ? "DISMISSED" : "QUALIFIED";
    await db.discoveryCandidate.update({ where: { id, workspaceId: ctx.workspaceId }, data: { status, opportunityId } });
    return { result: { opportunityId, status }, log: { action: "discovery.reviewed", objectType: "DiscoveryCandidate", objectId: id, after: { status, opportunityId } } };
  });
}
