import "server-only";
import { z } from "zod";
import { providerJson } from "./http";
import { ProviderRequestError } from "./provider-errors";
import { PartialDiscoveryError } from "./opportunity-source";
import type { ProviderConfig } from "./discovery";
import type { SearchCriteria } from "@/lib/opportunities/query-parser";
import type { SourceDocument } from "@/lib/opportunities/extractor";
import { mapLinkedInPost } from "@/lib/opportunities/linkedin-post";
import { effectivePlan, linkedInDateWindow, resolveOptions, type LinkedInDateFilter } from "@/lib/opportunities/linkedin-plan";
import { freshCheckpoint, PageFetchError, runLinkedInPlan, type PageRecord } from "@/lib/opportunities/linkedin-run";

export const LINKEDIN_POSTS_PROVIDER = "linkedin_posts";
// A third-party Apify actor, not a LinkedIn API. Its output format is not published, so mapLinkedInPost reads it tolerantly.
export const LINKEDIN_POSTS_ACTOR = "apimaestro~linkedin-posts-search-scraper-no-cookies";
const API = "https://api.apify.com/v2";
const RUN_TIMEOUT_S = 120;
const WAIT_S = 60;
// How long one page may take before it is left for a retry to collect, rather than blocking the job.
const POLL_BUDGET_MS = 180_000;

/** The actor's input for one page. `total_posts` is never sent: it overrides `page_number`. */
export type ActorInput = { keyword: string; sort_type: "relevance" | "date_posted"; date_filter: LinkedInDateFilter; limit: number; page_number: number };

const runSchema = z.object({ data: z.object({ id: z.string(), status: z.string(), defaultDatasetId: z.string(), defaultKeyValueStoreId: z.string().optional(), startedAt: z.string().optional(), usageTotalUsd: z.number().optional() }) });
const runListSchema = z.object({ data: z.object({ items: z.array(z.object({ id: z.string(), status: z.string(), startedAt: z.string(), defaultKeyValueStoreId: z.string().optional() })) }) });
type Run = z.infer<typeof runSchema>["data"];
const ACTIVE = new Set(["READY", "RUNNING", "TIMING-OUT", "ABORTING"]);

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * One provider call with the waiting a page needs: a busy provider lock or this app's own
 * per-minute limit is waited out; Apify's 429 is backed off twice. Anything longer (the hourly or
 * daily limit) stops the run as rate-limited, and a refused token stops it outright.
 */
async function call(workspaceId: string, url: string, key: string, body: Record<string, unknown> | undefined, timeoutMs: number, sleep: Sleep): Promise<unknown> {
  let busy = 0; let limited = 0;
  for (;;) {
    try { return await providerJson(workspaceId, LINKEDIN_POSTS_PROVIDER, url, { Authorization: `Bearer ${key}` }, body, { timeoutMs }); }
    catch (error) {
      if (!(error instanceof ProviderRequestError)) throw new PageFetchError(error instanceof Error ? error.message : "LinkedIn post search failed.", "retryable");
      if (error.kind === "busy" && busy++ < 45) { await sleep(3000); continue; }
      if (error.kind === "rate_limited" && error.windowSeconds === 60 && limited++ < 2) { await sleep(61_000); continue; }
      if (error.kind === "rate_limited" && error.status === 429 && limited++ < 2) { await sleep(limited * 15_000); continue; }
      if (error.kind === "rate_limited") throw new PageFetchError(error.status === 429 ? "Apify is rate-limiting this account. Results so far are kept; resume later." : "This workspace's hourly or daily LinkedIn request limit is reached. Results so far are kept; resume later.", "rate_limited");
      if (error.kind === "http" && (error.status === 401 || error.status === 403)) throw new PageFetchError("Apify refused the token. Check it in Settings → Lead sources.", "fatal");
      if (error.kind === "http" && error.status === 402) throw new PageFetchError("Apify reports the account has no remaining credit. Results so far are kept.", "fatal");
      throw new PageFetchError(error.message, "retryable");
    }
  }
}

/**
 * A page whose start request may have reached Apify without its reply reaching here: look for a
 * run of this actor started since then with exactly this input, rather than pay for another.
 */
async function findStartedRun(workspaceId: string, key: string, input: ActorInput, since: string, sleep: Sleep): Promise<Run | null> {
  const list = runListSchema.safeParse(await call(workspaceId, `${API}/acts/${LINKEDIN_POSTS_ACTOR}/runs?desc=true&limit=10`, key, undefined, 15_000, sleep));
  if (!list.success) return null;
  for (const run of list.data.data.items) {
    if (Date.parse(run.startedAt) < Date.parse(since) - 30_000 || !run.defaultKeyValueStoreId) continue;
    const stored = z.object({ keyword: z.string(), page_number: z.number(), limit: z.number(), date_filter: z.string().optional() }).safeParse(await call(workspaceId, `${API}/key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT`, key, undefined, 15_000, sleep));
    if (stored.success && stored.data.keyword === input.keyword && stored.data.page_number === input.page_number && stored.data.limit === input.limit && (stored.data.date_filter ?? "") === input.date_filter) {
      const full = runSchema.safeParse(await call(workspaceId, `${API}/actor-runs/${run.id}`, key, undefined, 15_000, sleep));
      if (full.success) return full.data.data;
    }
  }
  return null;
}

/**
 * Fetches one page as an asynchronous Apify run, so the run id is recorded before waiting. A
 * retry then reads that run's dataset instead of starting (and paying for) the same page again.
 */
export async function fetchLinkedInPage(workspaceId: string, key: string, input: ActorInput, record: Pick<PageRecord, "runId" | "startedAt">, resumed: boolean, onStarted: (runId: string) => Promise<void>, sleep: Sleep = realSleep): Promise<{ items: unknown[]; runId: string; usageUsd: number | null }> {
  let run: Run | null = null;
  if (record.runId) run = runSchema.parse(await call(workspaceId, `${API}/actor-runs/${record.runId}`, key, undefined, 15_000, sleep)).data;
  else if (resumed && record.startedAt) run = await findStartedRun(workspaceId, key, input, record.startedAt, sleep);
  if (!run) {
    // maxItems caps what a pay-per-result run can charge at this page's limit.
    const started = runSchema.safeParse(await call(workspaceId, `${API}/acts/${LINKEDIN_POSTS_ACTOR}/runs?timeout=${RUN_TIMEOUT_S}&maxItems=${input.limit}&waitForFinish=${WAIT_S}`, key, input, (WAIT_S + 15) * 1000, sleep));
    if (!started.success) throw new PageFetchError("Apify's reply to starting the LinkedIn search was not in the expected format.", "fatal");
    run = started.data.data;
  }
  await onStarted(run.id);
  const deadline = Date.now() + POLL_BUDGET_MS;
  while (ACTIVE.has(run.status)) {
    if (Date.now() > deadline) throw new PageFetchError("The LinkedIn search run is still in progress. It is recorded and will be read, not re-run, when the search resumes.", "retryable");
    run = runSchema.parse(await call(workspaceId, `${API}/actor-runs/${run.id}?waitForFinish=${WAIT_S}`, key, undefined, (WAIT_S + 15) * 1000, sleep)).data;
  }
  // A timed-out or aborted run can still hold posts it was billed for, so its dataset is always read.
  const items = await call(workspaceId, `${API}/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=1000`, key, undefined, 30_000, sleep);
  if (!Array.isArray(items)) throw new PageFetchError("The LinkedIn post source returned something other than a list of posts.", "fatal");
  if (run.status === "FAILED" && items.length === 0) throw new PageFetchError("The LinkedIn search run failed at Apify without returning posts.", "retryable");
  return { items, runId: run.id, usageUsd: run.usageTotalUsd ?? null };
}

export function actorInput(keyword: string, page: number, limit: number, days: number): ActorInput {
  const window = linkedInDateWindow(days);
  return { keyword, sort_type: window.sort, date_filter: window.filter, limit, page_number: page };
}

/**
 * The adapter interface's plain search: the same plan and pagination as a discovery run, without
 * a checkpoint. Discovery runs use runLinkedInPlan directly so pages are stored as they arrive.
 */
export async function searchLinkedInPosts(workspaceId: string, config: ProviderConfig, query: SearchCriteria, key?: string, rawOptions: unknown = {}): Promise<SourceDocument[]> {
  if (!key) throw new Error("The Apify API token is missing.");
  const options = resolveOptions(rawOptions, config.maxPostsPerSearch);
  const plan = effectivePlan(query, options).map(p => p.keyword);
  const docs: SourceDocument[] = []; let returned = 0;
  const cp = await runLinkedInPlan(freshCheckpoint(plan, Date.now()), { ...options, targetQualified: Number.MAX_SAFE_INTEGER }, { days: query.dateRange.days, sort: linkedInDateWindow(query.dateRange.days).sort }, {
    fetchPage: async ({ keyword, page, limit, record, resumed, onStarted }) => { const r = await fetchLinkedInPage(workspaceId, key, actorInput(keyword, page, limit, query.dateRange.days), record, resumed, onStarted); returned += r.items.length; return r; },
    mapItem: (item, keyword) => mapLinkedInPost(item, LINKEDIN_POSTS_PROVIDER, keyword),
    keyOf: doc => String(doc.rawSourceReference.postKey ?? doc.sourceUrl),
    processDocs: async batch => { docs.push(...batch); return batch.map(() => "review:unprocessed" as const); },
    save: async () => {}, cancelled: async () => false, now: () => Date.now(),
  });
  // Posts that arrive but cannot be read must not look like "no posts found".
  if (returned > 0 && docs.length === 0 && cp.pages.every(p => (p.unique ?? 0) === 0 && (p.duplicates ?? 0) === 0)) throw new Error(`The LinkedIn post source returned ${returned} posts in a format this app cannot read, so none were used. The scraper's output may have changed.`);
  if (cp.stop === "rate_limited" || cp.stop === "provider_error") {
    if (docs.length) throw new PartialDiscoveryError(cp.stopDetail ?? "LinkedIn post search stopped early.", docs);
    throw new Error(cp.stopDetail ?? "LinkedIn post search failed.");
  }
  return docs;
}

/** Checks the token against Apify's account endpoint, which is free, rather than paying for a scrape. */
export async function checkLinkedInPostsAccess(workspaceId: string, key?: string) {
  if (!key) return { ok: false, message: "Add your Apify API token first." };
  await providerJson(workspaceId, LINKEDIN_POSTS_PROVIDER, "https://api.apify.com/v2/users/me", { Authorization: `Bearer ${key}` });
  return { ok: true, message: "Apify accepted the token. No posts were scraped or charged by this test." };
}
