import "server-only";
import { DISCOVERY_PROVIDERS } from "@/lib/providers/opportunity-source";
import { db } from "@/lib/db";
import { parseOpportunityQuery, criteriaSchema } from "@/lib/opportunities/query-parser";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { parseDiscoveryOptions } from "@/lib/opportunities/linkedin-plan";
import { runDuePhraseWatches } from "./phrase-watches";
export async function refreshOpportunityWatches(workspaceId: string) {
  await db.discoveryCandidate.deleteMany({ where: { workspaceId, expiresAt: { lte: new Date() } } });
  // Purge source text when its licensed retention window ends, including derived versions.
  const expiredSources = await db.opportunitySource.findMany({ where: { workspaceId, expiresAt: { lte: new Date() } }, select: { id: true, opportunityId: true, sourceUrl: true } });
  for (const source of expiredSources) await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId}::uuid FOR UPDATE`;
    const stillExpired = await tx.opportunitySource.findFirst({ where: { workspaceId, id: source.id, expiresAt: { lte: new Date() } } });
    if (!stillExpired) return;
    await tx.opportunityEvidence.deleteMany({ where: { workspaceId, opportunityId: source.opportunityId, sourceUrl: source.sourceUrl } });
    await tx.opportunityVersion.deleteMany({ where: { workspaceId, sourceId: source.id } });
    await tx.opportunitySource.deleteMany({ where: { workspaceId, id: source.id, expiresAt: { lte: new Date() } } });
    const remaining = await tx.opportunitySource.count({ where: { workspaceId, opportunityId: source.opportunityId } });
    if (!remaining) await tx.opportunity.deleteMany({ where: { workspaceId, id: source.opportunityId } });
    else await tx.opportunity.updateMany({ where: { workspaceId, id: source.opportunityId }, data: { summary: null, intentScore: 0, opportunityScore: 0, requirements: [], scores: {} } });
  });
  const watches = await db.savedSearch.findMany({ where: { workspaceId, surface: "opportunities", alertEnabled: true, deletedAt: null } });
  let queued = 0;
  for (const watch of watches) {
    if (!watch.createdById) continue;
    const member = await db.workspaceMember.findFirst({ where: { workspaceId, userId: watch.createdById, deletedAt: null }, include: { role: true } });
    if (!member?.role.permissions.includes("leads.edit")) continue;
    const parsed = z.object({ query: z.string().min(3).max(2000), providers: z.array(z.enum(DISCOVERY_PROVIDERS)), cadenceHours: z.number().int().min(6).max(168), criteria: criteriaSchema.optional(), options: z.unknown().optional() }).safeParse(watch.filterJson);
    if (!parsed.success) continue;
    const bucket = Math.floor(Date.now() / (parsed.data.cadenceHours * 3600000));
    const idempotencyKey = `watch:${watch.id}:${bucket}`;
    const search = await db.opportunitySearch.upsert({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } }, create: { workspaceId, createdById: watch.createdById, savedSearchId: watch.id, query: parsed.data.query, criteria: parsed.data.criteria ?? parseOpportunityQuery(parsed.data.query), providers: parsed.data.providers, options: parseDiscoveryOptions(parsed.data.options) as Prisma.InputJsonValue, idempotencyKey }, update: {} });
    if (search.state !== "QUEUED") continue;
    const result = await enqueue(JOB.OPPORTUNITY_DISCOVERY, { workspaceId, searchId: search.id }, { dedupeKey: search.id, dedupeWindowSec: 0 });
    if (result.queued) queued++;
  }
  const phrases = await runDuePhraseWatches(workspaceId);
  return { queued, phrasesStarted: phrases.started, phrasesSkipped: phrases.skipped.length };
}
