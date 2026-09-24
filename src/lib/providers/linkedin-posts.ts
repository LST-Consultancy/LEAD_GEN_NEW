import "server-only";
import { providerJson } from "./http";
import { findStartedRun, getRun, readDataset, realSleep, startRun, waitForRun, type ApifyRunView, type Sleep } from "./apify";
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
const RUN_TIMEOUT_S = 120;
// How long one page may take before it is left for a retry to collect, rather than blocking the job.
const POLL_BUDGET_MS = 180_000;

/** The actor's input for one page. `total_posts` is never sent: it overrides `page_number`. */
export type ActorInput = { keyword: string; sort_type: "relevance" | "date_posted"; date_filter: LinkedInDateFilter; limit: number; page_number: number };

/**
 * Fetches one page as an asynchronous Apify run, so the run id is recorded before waiting. A
 * retry then reads that run's dataset instead of starting (and paying for) the same page again.
 */
export async function fetchLinkedInPage(workspaceId: string, key: string, input: ActorInput, record: Pick<PageRecord, "runId" | "startedAt">, resumed: boolean, onStarted: (runId: string) => Promise<void>, sleep: Sleep = realSleep): Promise<{ items: unknown[]; runId: string; usageUsd: number | null }> {
  const P = LINKEDIN_POSTS_PROVIDER;
  let run: ApifyRunView | null = null;
  if (record.runId) run = await getRun(P, workspaceId, key, record.runId, sleep);
  else if (resumed && record.startedAt) run = await findStartedRun(P, workspaceId, key, LINKEDIN_POSTS_ACTOR, input, record.startedAt, sleep);
  // maxItems caps what a pay-per-result run can charge at this page's limit.
  if (!run) run = await startRun(P, workspaceId, key, LINKEDIN_POSTS_ACTOR, input, { timeoutS: RUN_TIMEOUT_S, maxItems: input.limit }, sleep);
  await onStarted(run.id);
  run = await waitForRun(P, workspaceId, key, run, { budgetMs: POLL_BUDGET_MS }, sleep);
  // A timed-out or aborted run can still hold posts it was billed for, so its dataset is always read.
  const items = await readDataset(P, workspaceId, key, run.defaultDatasetId, 1000, sleep);
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
