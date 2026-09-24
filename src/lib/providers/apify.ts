import "server-only";
import { z } from "zod";
import { providerJson } from "./http";
import { ProviderRequestError } from "./provider-errors";
import { PageFetchError } from "@/lib/opportunities/linkedin-run";

/**
 * The one way this app runs an Apify Actor: start it asynchronously, hand the run id to the
 * caller before waiting, poll, then page through the dataset. Discovery (LinkedIn posts) and
 * enrichment both use it, so waiting out limits, reconciling a lost start reply and refusing a
 * bad token behave the same everywhere. The token only ever travels in the Authorization header.
 */

const API = "https://api.apify.com/v2";
export const WAIT_S = 60;
const ACTIVE = new Set(["READY", "RUNNING", "TIMING-OUT", "ABORTING"]);
export const runSchema = z.object({ data: z.object({ id: z.string(), status: z.string(), defaultDatasetId: z.string(), defaultKeyValueStoreId: z.string().optional(), startedAt: z.string().optional(), usageTotalUsd: z.number().optional() }) });
const runListSchema = z.object({ data: z.object({ items: z.array(z.object({ id: z.string(), status: z.string(), startedAt: z.string(), defaultKeyValueStoreId: z.string().optional() })) }) });
export type ApifyRunView = z.infer<typeof runSchema>["data"];
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** "user/actor" (how Apify documents Actors) → "user~actor" (how its API addresses them). */
export const actorPath = (actorId: string) => encodeURIComponent(actorId.replace("/", "~")).replace("%7E", "~");
export const ACTOR_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}[/~][a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

/**
 * One provider call with the waiting a run needs: a busy provider lock or this app's own
 * per-minute limit is waited out; Apify's 429 is backed off twice. Anything longer (the hourly or
 * daily limit) stops as rate-limited, and a refused token or empty balance stops outright.
 */
export async function apifyCall(provider: string, workspaceId: string, url: string, key: string, body: Record<string, unknown> | undefined, timeoutMs: number, sleep: Sleep = realSleep): Promise<unknown> {
  let busy = 0; let limited = 0;
  for (;;) {
    try { return await providerJson(workspaceId, provider, url, { Authorization: `Bearer ${key}` }, body, { timeoutMs }); }
    catch (error) {
      if (!(error instanceof ProviderRequestError)) throw new PageFetchError(error instanceof Error ? error.message : "The Apify request failed.", "retryable");
      if (error.kind === "busy" && busy++ < 45) { await sleep(3000); continue; }
      if (error.kind === "rate_limited" && error.windowSeconds === 60 && limited++ < 2) { await sleep(61_000); continue; }
      if (error.kind === "rate_limited" && error.status === 429 && limited++ < 2) { await sleep(limited * 15_000); continue; }
      if (error.kind === "rate_limited") throw new PageFetchError(error.status === 429 ? "Apify is rate-limiting this account. Results so far are kept; try again later." : "This workspace's hourly or daily Apify request limit is reached. Results so far are kept; try again later.", "rate_limited");
      if (error.kind === "http" && (error.status === 401 || error.status === 403)) throw new PageFetchError("Apify refused the token, or this Actor is not available to the account. Check the token in Settings → Lead sources and that the Actor can be run from your Apify account.", "fatal");
      if (error.kind === "http" && error.status === 402) throw new PageFetchError("Apify reports the account has no remaining credit or has hit its spending limit. Results so far are kept.", "fatal");
      if (error.kind === "http" && error.status === 404) throw new PageFetchError("Apify could not find that Actor or run. Check the Actor reference in Settings → Lead sources.", "fatal");
      throw new PageFetchError(error.message, "retryable");
    }
  }
}

/**
 * A run whose start request may have reached Apify without its reply reaching here: look for a run
 * of this Actor started since then whose stored INPUT is this input, rather than pay for another.
 */
export async function findStartedRun(provider: string, workspaceId: string, key: string, actorId: string, input: Record<string, unknown>, since: string, sleep: Sleep = realSleep): Promise<ApifyRunView | null> {
  const list = runListSchema.safeParse(await apifyCall(provider, workspaceId, `${API}/acts/${actorPath(actorId)}/runs?desc=true&limit=10`, key, undefined, 15_000, sleep));
  if (!list.success) return null;
  const wanted = stableJson(input);
  for (const run of list.data.data.items) {
    if (Date.parse(run.startedAt) < Date.parse(since) - 30_000 || !run.defaultKeyValueStoreId) continue;
    const stored = await apifyCall(provider, workspaceId, `${API}/key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT`, key, undefined, 15_000, sleep);
    if (stableJson(stored) === wanted) {
      const full = runSchema.safeParse(await apifyCall(provider, workspaceId, `${API}/actor-runs/${run.id}`, key, undefined, 15_000, sleep));
      if (full.success) return full.data.data;
    }
  }
  return null;
}

/** Key order must not make the same input look different. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function getRun(provider: string, workspaceId: string, key: string, runId: string, sleep: Sleep = realSleep) {
  return runSchema.parse(await apifyCall(provider, workspaceId, `${API}/actor-runs/${runId}`, key, undefined, 15_000, sleep)).data;
}

/**
 * Starts a run. `maxItems` caps what a pay-per-result run can charge, and `maxTotalChargeUsd` caps a
 * pay-per-event run; both are Apify run options, not Actor input.
 */
export async function startRun(provider: string, workspaceId: string, key: string, actorId: string, input: Record<string, unknown>, opts: { timeoutS: number; maxItems?: number; maxTotalChargeUsd?: number }, sleep: Sleep = realSleep): Promise<ApifyRunView> {
  const q = new URLSearchParams({ timeout: String(opts.timeoutS) });
  if (opts.maxItems) q.set("maxItems", String(opts.maxItems));
  if (opts.maxTotalChargeUsd) q.set("maxTotalChargeUsd", opts.maxTotalChargeUsd.toFixed(3));
  q.set("waitForFinish", String(WAIT_S));
  const started = runSchema.safeParse(await apifyCall(provider, workspaceId, `${API}/acts/${actorPath(actorId)}/runs?${q}`, key, input, (WAIT_S + 15) * 1000, sleep));
  if (!started.success) throw new PageFetchError("Apify's reply to starting the run was not in the expected format.", "fatal");
  return started.data.data;
}

/** Polls until the run ends. A cancelled caller aborts the run so it stops charging. */
export async function waitForRun(provider: string, workspaceId: string, key: string, run: ApifyRunView, opts: { budgetMs: number; shouldCancel?: () => Promise<boolean> }, sleep: Sleep = realSleep): Promise<ApifyRunView> {
  const deadline = Date.now() + opts.budgetMs;
  while (ACTIVE.has(run.status)) {
    if (opts.shouldCancel && await opts.shouldCancel()) {
      await apifyCall(provider, workspaceId, `${API}/actor-runs/${run.id}/abort`, key, {}, 15_000, sleep).catch(() => null);
      throw new PageFetchError("Cancelled. The Apify run was asked to stop; anything it had already returned is billed and kept.", "fatal");
    }
    if (Date.now() > deadline) throw new PageFetchError("The Apify run is still in progress. It is recorded and will be read, not re-run, when this is retried.", "retryable");
    run = runSchema.parse(await apifyCall(provider, workspaceId, `${API}/actor-runs/${run.id}?waitForFinish=${WAIT_S}`, key, undefined, (WAIT_S + 15) * 1000, sleep)).data;
  }
  return run;
}

const PAGE = 1000;
/** Reads a dataset a page at a time, up to `maxItems`. A timed-out or aborted run still has billed items. */
export async function readDataset(provider: string, workspaceId: string, key: string, datasetId: string, maxItems: number, sleep: Sleep = realSleep): Promise<unknown[]> {
  const items: unknown[] = [];
  while (items.length < maxItems) {
    const want = Math.min(PAGE, maxItems - items.length);
    const page = await apifyCall(provider, workspaceId, `${API}/datasets/${datasetId}/items?clean=true&format=json&offset=${items.length}&limit=${want}`, key, undefined, 30_000, sleep);
    if (!Array.isArray(page)) throw new PageFetchError("Apify returned something other than a list of results.", "fatal");
    items.push(...page);
    if (page.length < want) break;
  }
  return items.slice(0, maxItems);
}
