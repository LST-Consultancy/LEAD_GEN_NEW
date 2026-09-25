import "server-only";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { decryptCredential } from "@/lib/providers/credentials";
import { ProviderRequestError } from "@/lib/providers/provider-errors";
import { PageFetchError } from "@/lib/opportunities/linkedin-run";
import { CAPABILITIES, type Cost, type EnrichmentProvider, type Operation } from "@/lib/enrichment/capabilities";
import { FALLBACK_LABEL, providerState, type FallbackConfig } from "@/lib/enrichment/fallback";
import { classifyProviderError, OUTCOME_LABEL, TERMINAL_ANSWERS, type Outcome } from "@/lib/enrichment/provider-outcome";

/**
 * The shared fallback orchestration every enrichment stage uses: which providers may be tried for
 * an operation, in order, and one bounded, recorded attempt at a time.
 *
 * Every attempt is written to the ProviderCall ledger *before* the call, under a lock on the
 * workspace row, and only after checking this run's and today's caps — so a redelivered job, a
 * second press, or two runs started together cannot spend more than the limits allow. A provider
 * that already answered for the same target inside the freshness window is not asked again.
 */
export type Attempt = { provider: EnrichmentProvider; operation: Operation; call: string; target: string; outcome: Outcome; detail: string; at: string };
export type FallbackCtx = {
  workspaceId: string; runId: string; refresh: boolean; freshDays: number; cfg: FallbackConfig;
  cancelled: () => Promise<boolean>; attempts: Attempt[];
};
export type Ready = { provider: EnrichmentProvider; key: string };

/**
 * The providers to try for one operation, in the configured order, and a skip record for each one
 * that cannot be tried (fallback off, operation off, unsupported, not connected).
 */
export async function providersFor(fx: FallbackCtx, operation: Operation): Promise<{ ready: Ready[]; skipped: Attempt[]; off: string | null }> {
  if (!fx.cfg.enabled) return { ready: [], skipped: [], off: "Contact providers are off (Settings → Lead Sources & APIs → Apify enrichment)." };
  if (!fx.cfg.operations[operation]) return { ready: [], skipped: [], off: `Fallback providers are switched off for ${operation === "verify" ? "verification" : operation === "company" ? "company research" : operation === "people" ? "finding people" : "finding emails"}.` };
  const rows = await db.providerConnection.findMany({ where: { workspaceId: fx.workspaceId, provider: { in: [...fx.cfg.order] } } });
  const ready: Ready[] = []; const skipped: Attempt[] = [];
  const at = new Date().toISOString();
  for (const p of fx.cfg.order) {
    const cap = CAPABILITIES[p][operation];
    if (!cap.supported) { skipped.push({ provider: p, operation, call: "—", target: "—", outcome: "unsupported", detail: cap.why, at }); continue; }
    const r = rows.find(x => x.provider === p);
    const state = providerState(p, r ? { enabled: r.enabled, allowedEnrichment: r.allowedEnrichment, allowedStorage: r.allowedStorage, hasKey: Boolean(r.encryptedCredentials), status: r.status } : null);
    if (!state.usable || !r?.encryptedCredentials) { skipped.push({ provider: p, operation, call: "—", target: "—", outcome: "not_connected", detail: state.why ?? `${FALLBACK_LABEL[p]} is not ready.`, at }); continue; }
    ready.push({ provider: p, key: decryptCredential(r.encryptedCredentials, fx.workspaceId, p) });
  }
  // Recorded with the stage's attempts, so the screen shows why a provider was not asked.
  fx.attempts.push(...skipped);
  return { ready, skipped, off: null };
}

type CallResult<T> = { outcome: "found" | "no_match" | "review"; value?: T; detail?: string };

/**
 * One recorded attempt. `units` is what the call can spend: 0 for free (quota-only) calls, which
 * have their own per-run limit instead of the paid caps.
 */
export async function attempt<T>(fx: FallbackCtx, a: { provider: EnrichmentProvider; operation: Operation; call: string; targetKey: string; target: string; cost: Cost }, fn: () => Promise<CallResult<T>>): Promise<{ record: Attempt; value?: T }> {
  const record = (outcome: Outcome, detail: string): Attempt => { const r = { provider: a.provider, operation: a.operation, call: a.call, target: a.target, outcome, detail, at: new Date().toISOString() }; fx.attempts.push(r); return r; };
  if (await fx.cancelled()) return { record: record("cancelled", "The run was cancelled.") };
  const where = { workspaceId: fx.workspaceId, provider: a.provider, operation: a.operation, targetKey: a.targetKey };
  // Asked recently (in another run) and it answered: not asked again unless "Run again".
  if (!fx.refresh) {
    const prior = await db.providerCall.findFirst({ where: { ...where, enrichmentRunId: { not: fx.runId }, status: { in: TERMINAL_ANSWERS.map(o => o.toUpperCase()) }, createdAt: { gte: new Date(Date.now() - fx.freshDays * 86400000) } }, orderBy: { createdAt: "desc" } });
    if (prior) return { record: record("cached", `${FALLBACK_LABEL[a.provider]} was asked ${Math.max(0, Math.round((Date.now() - prior.createdAt.getTime()) / 86400000))} days ago (${prior.status.toLowerCase().replace("_", " ")}); not asked again.`) };
  }
  const units = a.cost === "credit" ? 1 : 0;
  // Reserve under a lock on the workspace row, so concurrent runs see each other's reservations.
  const reserved = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${fx.workspaceId}::uuid FOR UPDATE`;
    const same = await tx.providerCall.findUnique({ where: { workspaceId_enrichmentRunId_provider_operation_targetKey: { ...where, enrichmentRunId: fx.runId } } });
    if (same) return { kind: "exists" as const, status: same.status };
    if (units > 0) {
      const [today, thisRun] = await Promise.all([
        tx.providerCall.count({ where: { workspaceId: fx.workspaceId, units: { gt: 0 }, createdAt: { gte: new Date(Date.now() - 86400000) } } }),
        tx.providerCall.count({ where: { workspaceId: fx.workspaceId, enrichmentRunId: fx.runId, units: { gt: 0 } } }),
      ]);
      if (thisRun >= fx.cfg.maxLookupsPerRun) return { kind: "budget" as const, detail: `This run's limit of ${fx.cfg.maxLookupsPerRun} paid lookups is used.` };
      if (today >= fx.cfg.maxLookupsPerDay) return { kind: "budget" as const, detail: `Today's limit of ${fx.cfg.maxLookupsPerDay} paid lookups across all runs is used.` };
    } else {
      const free = await tx.providerCall.count({ where: { workspaceId: fx.workspaceId, enrichmentRunId: fx.runId, units: 0 } });
      if (free >= fx.cfg.maxFreeCallsPerRun) return { kind: "budget" as const, detail: `This run's limit of ${fx.cfg.maxFreeCallsPerRun} free searches is used.` };
    }
    const row = await tx.providerCall.create({ data: { ...where, enrichmentRunId: fx.runId, units, status: "STARTED" } });
    return { kind: "reserved" as const, id: row.id };
  });
  if (reserved.kind === "budget") return { record: record("budget", reserved.detail) };
  if (reserved.kind === "exists") {
    // A redelivered job: this exact call was already made (or started) in this run.
    if (reserved.status === "STARTED") return { record: record("interrupted", `A ${FALLBACK_LABEL[a.provider]} call for ${a.target} started earlier in this run and its answer was lost; it was not repeated. Use "Run again" to ask again.`) };
    return { record: record("cached", `Already asked in this run (${reserved.status.toLowerCase().replace("_", " ")}).`) };
  }
  let outcome: Outcome; let detail: string; let value: T | undefined;
  try {
    const r = await fn();
    outcome = r.outcome; value = r.value; detail = r.detail ?? (r.outcome === "found" ? "Found." : r.outcome === "review" ? "Held for review." : "No match.");
  } catch (e) {
    if (e instanceof ZodError) { outcome = "malformed"; detail = `${FALLBACK_LABEL[a.provider]}'s response did not match its documented shape (${e.issues[0]?.path.join(".") || "root"}); the adapter needs checking against the current API.`; }
    else if (e instanceof ProviderRequestError) ({ outcome, detail } = classifyProviderError(a.provider, e));
    else if (e instanceof PageFetchError) { outcome = "transient"; detail = e.message; }
    else { outcome = "transient"; detail = e instanceof Error && e.message.length < 200 ? e.message : "The call failed unexpectedly."; }
  }
  await db.providerCall.update({ where: { id: reserved.id }, data: { status: outcome.toUpperCase(), detail: detail.slice(0, 500), finishedAt: new Date() } });
  return { record: record(outcome, detail), value };
}

/** A one-line summary of what was tried, for a stage's reason. */
export function attemptsSummary(list: Attempt[]): string {
  if (!list.length) return "";
  const by = new Map<string, Attempt[]>();
  for (const a of list) by.set(a.provider, [...(by.get(a.provider) ?? []), a]);
  return [...by.entries()].map(([p, xs]) => {
    const counts = new Map<string, number>();
    for (const x of xs) counts.set(OUTCOME_LABEL[x.outcome], (counts.get(OUTCOME_LABEL[x.outcome]) ?? 0) + 1);
    return `${FALLBACK_LABEL[p as EnrichmentProvider]}: ${[...counts.entries()].map(([o, n]) => `${n} ${o}`).join(", ")}`;
  }).join(" · ");
}
