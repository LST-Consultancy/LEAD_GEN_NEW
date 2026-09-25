import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { parseOpportunityQuery } from "@/lib/opportunities/query-parser";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";
import { isQueueConfigured } from "@/lib/queue/connection";
import { toPlain } from "@/lib/serialize";
import { raiseNotification } from "./notify";
import { mutate, MutationError, loadScoped } from "./mutate";
import { PHRASE_PROVIDERS, providersForPhrase, UNWATCHABLE_REASON } from "@/lib/opportunities/phrase-sources";

type Phrase = { id: string; workspaceId: string; phrase: string; sourceKind: string; cadenceHours: number; negativeKeywords: string[]; createdById: string | null };

/** The member a phrase's run acts as: its creator while they can run discovery, else the longest-standing member who can. */
async function actorFor(p: Phrase) {
  const members = await db.workspaceMember.findMany({ where: { workspaceId: p.workspaceId, deletedAt: null }, include: { role: true }, orderBy: { createdAt: "asc" } });
  const can = members.filter(m => m.role.permissions.includes(PERMISSIONS.LEADS_EDIT));
  return can.find(m => m.userId === p.createdById) ?? can[0] ?? null;
}

/**
 * Starts one run of a phrase as a tracked discovery search, recorded as a SearchRun. The key is
 * bucketed by cadence (or by minute for a manual run), so the hourly job firing twice, or a double
 * click, starts one search — never two.
 */
async function startPhraseRun(p: Phrase, key: string) {
  if (!PHRASE_PROVIDERS[p.sourceKind]) return { started: false, reason: UNWATCHABLE_REASON };
  const connected = (await db.providerConnection.findMany({ where: { workspaceId: p.workspaceId, enabled: true, allowedSearch: true, allowedStorage: true }, select: { provider: true } })).map(c => c.provider);
  const providers = providersForPhrase(p.sourceKind, connected);
  if (!providers.length) return { started: false, reason: `None of the sources for this kind of phrase (${PHRASE_PROVIDERS[p.sourceKind].join(", ")}) is connected with search and storage rights.` };
  const actor = await actorFor(p);
  if (!actor) return { started: false, reason: "No member of this workspace can run discovery any more." };
  const criteria = { ...parseOpportunityQuery(p.phrase), negativeKeywords: p.negativeKeywords.slice(0, 20) };
  const search = await db.opportunitySearch.upsert({ where: { workspaceId_idempotencyKey: { workspaceId: p.workspaceId, idempotencyKey: key } },
    create: { workspaceId: p.workspaceId, createdById: actor.userId, searchPhraseId: p.id, query: p.phrase, criteria, providers, options: {}, idempotencyKey: key }, update: {} });
  await db.searchRun.upsert({ where: { idempotencyKey: key }, create: { workspaceId: p.workspaceId, searchPhraseId: p.id, state: "PENDING", idempotencyKey: key }, update: {} });
  await db.searchPhrase.update({ where: { id: p.id }, data: { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + p.cadenceHours * 3600000) } });
  if (search.state !== "QUEUED") return { started: false, reason: "This run already started.", searchId: search.id };
  const queued = await enqueue(JOB.OPPORTUNITY_DISCOVERY, { workspaceId: p.workspaceId, searchId: search.id }, { dedupeKey: search.id, dedupeWindowSec: 0 });
  if (!queued.queued) {
    await db.opportunitySearch.update({ where: { id: search.id }, data: { state: "FAILED", error: queued.detail, finishedAt: new Date() } });
    await db.searchRun.update({ where: { idempotencyKey: key }, data: { state: "FAILED", errorMessage: queued.detail, finishedAt: new Date() } });
    return { started: false, reason: queued.detail, searchId: search.id };
  }
  return { started: true, reason: null, searchId: search.id, providers };
}

/** Called by the hourly watch job: every active phrase whose next run is due. */
export async function runDuePhraseWatches(workspaceId: string, now = new Date()) {
  const due = await db.searchPhrase.findMany({ where: { workspaceId, deletedAt: null, isActive: true, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] } });
  let started = 0; const skipped: { id: string; reason: string }[] = [];
  for (const p of due) {
    const bucket = Math.floor(now.getTime() / (Math.max(1, p.cadenceHours) * 3600000));
    const r = await startPhraseRun(p, `phrase:${p.id}:${bucket}`);
    if (r.started) started++; else if (r.reason) {
      skipped.push({ id: p.id, reason: r.reason });
      // Not runnable now: look again at the next cadence rather than every hour.
      if (!r.searchId) await db.searchPhrase.update({ where: { id: p.id }, data: { nextRunAt: new Date(now.getTime() + p.cadenceHours * 3600000) } });
    }
  }
  return { started, skipped };
}

/** A person runs a phrase now. */
export async function runPhraseNow(ctx: AuthContext, id: string) {
  const p = await loadScoped(() => db.searchPhrase.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }), "That phrase");
  if (!isQueueConfigured()) throw new MutationError("Running a phrase needs Redis and the worker. Nothing was run or charged.", "queue_unavailable", 503);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const r = await startPhraseRun({ ...p, createdById: p.createdById ?? ctx.userId }, `phrase:${p.id}:manual:${Math.floor(Date.now() / 60000)}`);
    if (!r.started && !r.searchId) throw new MutationError(`${r.reason} Nothing was run or charged.`, "not_runnable", 422);
    return { result: toPlain({ ...r, note: r.started ? `Running “${p.phrase}” on ${r.providers?.join(", ")}. New matches appear in its run history and as a notification.` : r.reason }), log: { action: "search_phrase.run", objectType: "SearchPhrase", objectId: p.id, after: { searchId: r.searchId ?? null } } };
  });
}

/**
 * Closes a phrase's SearchRun when its discovery search ends, and alerts once for matches no
 * earlier run of the same phrase found. Called inside the search's finishing transaction.
 */
export async function finishPhraseRun(tx: Prisma.TransactionClient, search: { id: string; workspaceId: string; createdById: string; searchPhraseId: string | null; idempotencyKey: string }, state: string, found: number) {
  if (!search.searchPhraseId) return;
  const current = await tx.opportunitySearchResult.findMany({ where: { workspaceId: search.workspaceId, searchId: search.id }, select: { opportunityId: true } });
  const earlier = current.length ? await tx.opportunitySearchResult.findMany({ where: { workspaceId: search.workspaceId, opportunityId: { in: current.map(r => r.opportunityId) }, search: { workspaceId: search.workspaceId, searchPhraseId: search.searchPhraseId, id: { not: search.id }, finishedAt: { not: null } } }, select: { opportunityId: true } }) : [];
  const known = new Set(earlier.map(r => r.opportunityId));
  const fresh = current.filter(r => !known.has(r.opportunityId)).length;
  await tx.searchRun.updateMany({ where: { idempotencyKey: search.idempotencyKey, finishedAt: null }, data: { state: state === "FAILED" ? "FAILED" : state === "CANCELLED" ? "CANCELLED" : "SUCCEEDED", signalsFound: found, duplicates: current.length - fresh, leadsCreated: 0, finishedAt: new Date(), errorMessage: state === "FAILED" ? "The discovery search failed; see the search for each source's reason." : null } });
  if (fresh) {
    const phrase = await tx.searchPhrase.findFirst({ where: { id: search.searchPhraseId }, select: { phrase: true } });
    await raiseNotification({ data: { workspaceId: search.workspaceId, userId: search.createdById, kind: "LEAD_SIGNAL", title: `New matches for “${phrase?.phrase ?? "a watched phrase"}”`, body: `${fresh} ${fresh === 1 ? "opportunity" : "opportunities"} no earlier run of this phrase found. Review the evidence before outreach.`, href: `/opportunities?searchId=${search.id}` } }, tx);
  }
}

/** Per phrase: the connected sources it will run on, or why it cannot run on a schedule. */
export async function phraseWatchability(ctx: AuthContext) {
  const [phrases, connected] = await Promise.all([
    db.searchPhrase.findMany({ where: { workspaceId: ctx.workspaceId, deletedAt: null }, select: { id: true, sourceKind: true } }),
    db.providerConnection.findMany({ where: { workspaceId: ctx.workspaceId, enabled: true, allowedSearch: true, allowedStorage: true }, select: { provider: true } }),
  ]);
  const names = connected.map(c => c.provider);
  return Object.fromEntries(phrases.map(p => {
    const providers = providersForPhrase(p.sourceKind, names);
    return [p.id, { providers, reason: !PHRASE_PROVIDERS[p.sourceKind] ? UNWATCHABLE_REASON : providers.length ? null : `Connect one of: ${PHRASE_PROVIDERS[p.sourceKind].join(", ")} (Settings → Lead Sources & APIs).` }];
  })) as Record<string, { providers: string[]; reason: string | null }>;
}
