import "server-only";
import { db } from "@/lib/db";
import { assertPermission, type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getOpportunity } from "./opportunities";
import { mutate, MutationError, loadScoped } from "./mutate";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";
import { isQueueConfigured } from "@/lib/queue/connection";
import { enrichOpportunity, researchOpportunity } from "./opportunity-actions";
import { toPlain } from "@/lib/serialize";
export async function queueOpportunityAction(ctx: AuthContext, opportunityId: string, operation: "enrich" | "verify" | "research") {
  assertPermission(ctx, operation === "research" ? PERMISSIONS.LEADS_EDIT : PERMISSIONS.LEADS_REVEAL);
  await getOpportunity(ctx, opportunityId);
  if (!isQueueConfigured()) throw new MutationError("Start Redis and the worker before requesting opportunity analysis or enrichment.", "queue_unavailable", 503);
  return mutate(ctx, operation === "research" ? PERMISSIONS.LEADS_EDIT : PERMISSIONS.LEADS_REVEAL, async () => {
    const sync = await db.providerSync.create({ data: { workspaceId: ctx.workspaceId, provider: operation === "research" ? "ai" : operation === "verify" ? "hunter" : "contact_discovery", operation, jobId: opportunityId, state: "QUEUED" } });
    const queued = await enqueue(JOB.OPPORTUNITY_ACTION, { workspaceId: ctx.workspaceId, userId: ctx.userId, opportunityId, syncId: sync.id, operation }, { dedupeKey: sync.id, dedupeWindowSec: 0 });
    if (!queued.queued) { await db.providerSync.update({ where: { id: sync.id, workspaceId: ctx.workspaceId }, data: { state: "FAILED", error: queued.detail, finishedAt: new Date() } }); throw new MutationError(queued.detail, "queue_unavailable", 503); }
    return { result: { jobId: sync.id, note: "Queued. The worker will report the actual result here." }, log: { action: "opportunity.action_queued", objectType: "Opportunity", objectId: opportunityId, after: { operation } } };
  });
}
export async function getOpportunityAction(ctx: AuthContext, id: string) {
  const sync = await loadScoped(() => db.providerSync.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That operation");
  return toPlain({ id: sync.id, state: sync.state, error: sync.error, recordsUpdated: sync.recordsUpdated });
}
export async function runOpportunityAction(workspaceId: string, data: { userId: string; opportunityId: string; syncId: string; operation: "enrich" | "verify" | "research" }) {
  const sync = await db.providerSync.findFirst({ where: { id: data.syncId, workspaceId } });
  if (!sync || sync.state === "COMPLETED") return;
  const member = await db.workspaceMember.findFirst({ where: { workspaceId, userId: data.userId, deletedAt: null, workspace: { deletedAt: null } }, include: { user: true, workspace: true, role: true } });
  if (!member) { await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { state: "FAILED", error: "Requesting member no longer has workspace access.", finishedAt: new Date() } }); return; }
  const ctx: AuthContext = { userId: member.userId, sessionId: "worker", user: member.user, workspaceId, workspace: member.workspace, memberId: member.id, roleKey: member.role.key, roleName: member.role.name, permissions: member.role.permissions, workspaces: [] };
  await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { state: "RUNNING" } });
  try { if (data.operation === "research") await researchOpportunity(ctx, data.opportunityId); else { const result = await enrichOpportunity(ctx, data.opportunityId, data.operation === "verify"); await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { recordsUpdated: result.count } }); } await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { state: "COMPLETED", finishedAt: new Date() } }); }
  catch (error) { await db.providerSync.update({ where: { id: sync.id, workspaceId }, data: { state: "FAILED", error: error instanceof MutationError ? error.message : "Provider operation failed. Check access and quota; partial enrichment may have been saved.", finishedAt: new Date() } }); }
}
