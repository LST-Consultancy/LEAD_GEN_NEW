import type { SourceDocument } from "./extractor";
import type { ResolvedOptions } from "./linkedin-plan";

/**
 * Walks a LinkedIn query plan page by page, breadth first: page 1 of every query, then page 2 of
 * the queries still producing new posts, and so on. Pure orchestration — every side effect (the
 * provider, storage, the clock) is injected, so the stopping rules can be tested exactly.
 *
 * Each page is fetched, deduplicated, processed and checkpointed before the next one starts. A
 * redelivered job therefore resumes after the last finished page, and a page whose provider run
 * was already started is re-read from that run instead of paying for a new one.
 */

export type StopReason = "target_reached" | "results_exhausted" | "depth_limit" | "budget_posts" | "budget_runtime" | "cancelled" | "rate_limited" | "provider_error" | "no_queries";
export type QueryEnd = "exhausted" | "repeated_page" | "no_new_results" | "date_window_end" | "page_cap" | "provider_error";
/** One label per unique post. Its prefix is the funnel bucket it is counted in; the rest is the reason. */
export type Outcome = "qualified_new" | "qualified_known" | `review:${string}` | `rejected:${string}`;

export type PageRecord = {
  q: number; page: number; status: "started" | "done" | "failed"; limit: number; attempts: number;
  runId?: string | null; startedAt?: string;
  returned?: number; unmappable?: number; duplicates?: number; unique?: number;
  /** Every post key on the page (for repeated-page detection) and the ones first seen here. */
  keys?: string[]; newKeys?: string[];
  outcomes?: Record<string, number>; end?: QueryEnd; error?: string; usageUsd?: number | null;
};
export type RunCheckpoint = { v: 1; plan: string[]; pages: PageRecord[]; stop?: StopReason; stopDetail?: string; startedAt: string };

export class PageFetchError extends Error {
  constructor(message: string, readonly kind: "rate_limited" | "retryable" | "fatal") { super(message); }
}

export type RunDeps = {
  fetchPage(args: { keyword: string; page: number; limit: number; record: PageRecord; resumed: boolean; onStarted: (runId: string) => Promise<void> }): Promise<{ items: unknown[]; runId: string | null; usageUsd?: number | null }>;
  mapItem(item: unknown, keyword: string): SourceDocument | null;
  keyOf(doc: SourceDocument): string;
  processDocs(docs: SourceDocument[], at: { keyword: string; page: number }): Promise<Outcome[]>;
  save(checkpoint: RunCheckpoint): Promise<void>;
  cancelled(): Promise<boolean>;
  now(): number;
};
export type RunWindow = { days: number; sort: "relevance" | "date_posted" };

const MAX_PAGE_ATTEMPTS = 2;
const MAX_FAILED_PAGES = 3;
const MIN_USEFUL_PAGE = 10;

export function freshCheckpoint(plan: string[], now: number): RunCheckpoint {
  return { v: 1, plan, pages: [], startedAt: new Date(now).toISOString() };
}

const sum = (pages: PageRecord[], f: (p: PageRecord) => number | undefined) => pages.reduce((n, p) => n + (f(p) ?? 0), 0);
export const qualifiedSoFar = (cp: RunCheckpoint) => sum(cp.pages, p => (p.outcomes?.qualified_new ?? 0) + (p.outcomes?.qualified_known ?? 0));
/** What the provider was asked for, which is the most it can bill. Reserved before each page. */
export const postsRequested = (cp: RunCheckpoint) => sum(cp.pages, p => (p.status === "done" ? p.returned : p.limit));

function queryState(cp: RunCheckpoint, q: number): { ended: QueryEnd | null; nextPage: number } {
  const pages = cp.pages.filter(p => p.q === q).sort((a, b) => a.page - b.page);
  const last = pages.at(-1);
  if (!last) return { ended: null, nextPage: 1 };
  if (last.status === "done") return { ended: last.end ?? null, nextPage: last.page + 1 };
  if (last.status === "failed" && last.attempts >= MAX_PAGE_ATTEMPTS) return { ended: "provider_error", nextPage: last.page };
  return { ended: null, nextPage: last.page }; // started or failed-but-retryable: redo this page
}

export async function runLinkedInPlan(cp: RunCheckpoint, options: Pick<ResolvedOptions, "maxPagesPerQuery" | "postsPerPage" | "maxPosts" | "targetQualified" | "maxRuntimeSec">, window: RunWindow, deps: RunDeps): Promise<RunCheckpoint> {
  if (!cp.plan.length) return { ...cp, stop: "no_queries", stopDetail: "No query could be built from this search." };
  // Each invocation gets the runtime budget; the post budget is what bounds the total across resumes.
  const deadline = deps.now() + options.maxRuntimeSec * 1000;
  const cutoff = deps.now() - window.days * 86400000;
  const stop = async (reason: StopReason, detail?: string) => { const next = { ...cp, stop: reason, ...(detail ? { stopDetail: detail } : {}) }; await deps.save(next); return next; };

  for (let page = 1; page <= options.maxPagesPerQuery; page++) {
    for (let q = 0; q < cp.plan.length; q++) {
      const state = queryState(cp, q);
      if (state.ended || state.nextPage !== page) continue;
      if (await deps.cancelled()) return stop("cancelled");
      if (qualifiedSoFar(cp) >= options.targetQualified) return stop("target_reached");
      if (deps.now() >= deadline) return stop("budget_runtime", `Stopped at the ${Math.round(options.maxRuntimeSec / 60)}-minute runtime limit.`);
      if (sum(cp.pages, p => (p.status === "failed" && p.attempts >= MAX_PAGE_ATTEMPTS ? 1 : 0)) >= MAX_FAILED_PAGES) return stop("provider_error", "Several pages failed at the provider.");

      const existing = cp.pages.find(p => p.q === q && p.page === page);
      const reserved = postsRequested({ ...cp, pages: cp.pages.filter(p => p !== existing) });
      const limit = existing?.runId ? existing.limit : Math.min(options.postsPerPage, options.maxPosts - reserved);
      if (limit < Math.min(MIN_USEFUL_PAGE, options.postsPerPage)) return stop("budget_posts", `Reached the budget of ${options.maxPosts} posts.`);

      const record: PageRecord = existing
        ? { ...existing, status: "started", attempts: existing.attempts + (existing.status === "failed" ? 1 : 0), limit }
        : { q, page, status: "started", limit, attempts: 1, startedAt: new Date(deps.now()).toISOString() };
      cp = { ...cp, pages: [...cp.pages.filter(p => p !== existing), record] };
      await deps.save(cp);

      let fetched: Awaited<ReturnType<RunDeps["fetchPage"]>>;
      try {
        fetched = await deps.fetchPage({ keyword: cp.plan[q], page, limit, record, resumed: Boolean(existing), onStarted: async runId => { record.runId = runId; await deps.save(cp); } });
      } catch (error) {
        const e = error instanceof PageFetchError ? error : new PageFetchError(error instanceof Error ? error.message : "Provider request failed.", "retryable");
        record.status = "failed"; record.error = e.message;
        if (e.kind === "rate_limited") { await deps.save(cp); return stop("rate_limited", e.message); }
        if (e.kind === "fatal") { record.attempts = MAX_PAGE_ATTEMPTS; await deps.save(cp); return stop("provider_error", e.message); }
        await deps.save(cp);
        // A transient failure gets one more attempt at this page before the query is given up.
        if (record.attempts < MAX_PAGE_ATTEMPTS) q--;
        continue;
      }

      const seen = new Set(cp.pages.filter(p => p !== record && p.status === "done").flatMap(p => p.keys ?? []));
      const previous = cp.pages.find(p => p.q === q && p.page === page - 1);
      const docs: SourceDocument[] = []; const keys: string[] = []; const newKeys: string[] = [];
      let unmappable = 0; let duplicates = 0;
      for (const item of fetched.items) {
        const doc = deps.mapItem(item, cp.plan[q]);
        if (!doc) { unmappable++; continue; }
        const key = deps.keyOf(doc);
        keys.push(key);
        if (seen.has(key)) { duplicates++; continue; }
        seen.add(key); newKeys.push(key); docs.push(doc);
      }
      const outcomes: Record<string, number> = {};
      if (docs.length) for (const o of await deps.processDocs(docs, { keyword: cp.plan[q], page })) outcomes[o] = (outcomes[o] ?? 0) + 1;

      let end: QueryEnd | undefined;
      const repeated = page > 1 && keys.length > 0 && previous?.keys?.length && keys.every(k => previous.keys!.includes(k));
      const oldest = docs.length && docs.every(d => d.postedAt) ? Math.min(...docs.map(d => Date.parse(d.postedAt!))) : null;
      // A page well short of its limit is the end of the results. One slightly short is not proof,
      // and asking for a page that turns out empty costs nothing, since the actor bills per post.
      if (fetched.items.length === 0 || fetched.items.length < Math.ceil(limit / 2)) end = "exhausted";
      else if (repeated) end = "repeated_page";
      else if (newKeys.length === 0) end = "no_new_results";
      else if (window.sort === "date_posted" && oldest !== null && oldest < cutoff) end = "date_window_end";
      else if (page >= options.maxPagesPerQuery) end = "page_cap";

      Object.assign(record, { status: "done", runId: fetched.runId, returned: fetched.items.length, unmappable, duplicates, unique: docs.length, keys, newKeys, outcomes, end, usageUsd: fetched.usageUsd ?? null, error: undefined });
      await deps.save(cp);
    }
  }
  const ends = cp.plan.map((_, q) => queryState(cp, q).ended);
  if (qualifiedSoFar(cp) >= options.targetQualified) return stop("target_reached");
  if (ends.every(e => e === "provider_error")) return stop("provider_error", "Every query failed at the provider.");
  return stop(ends.some(e => e === "page_cap") ? "depth_limit" : "results_exhausted");
}

export type Funnel = {
  queriesPlanned: number; queriesRun: number; pagesAttempted: number; pagesCompleted: number; pagesFailed: number;
  postsRequested: number; returned: number; unmappable: number; duplicates: number; unique: number;
  qualifiedNew: number; qualifiedKnown: number; review: Record<string, number>; rejected: Record<string, number>;
  usageUsd: number | null;
  perQuery: { keyword: string; pages: number; returned: number; unique: number; qualified: number; end: QueryEnd | null }[];
};

/**
 * The counts shown on screen, derived only from the checkpoint. Two identities hold by
 * construction and are checked by `reconcile`: returned = unmappable + duplicates + unique, and
 * unique = qualified + needs review + rejected. Each post has exactly one outcome, so no
 * rejection is counted twice.
 */
export function funnelOf(cp: RunCheckpoint): Funnel {
  const done = cp.pages.filter(p => p.status === "done");
  const review: Record<string, number> = {}; const rejected: Record<string, number> = {};
  let qualifiedNew = 0; let qualifiedKnown = 0;
  for (const p of done) for (const [label, n] of Object.entries(p.outcomes ?? {})) {
    if (label === "qualified_new") qualifiedNew += n;
    else if (label === "qualified_known") qualifiedKnown += n;
    else if (label.startsWith("review:")) review[label.slice(7)] = (review[label.slice(7)] ?? 0) + n;
    else if (label.startsWith("rejected:")) rejected[label.slice(9)] = (rejected[label.slice(9)] ?? 0) + n;
  }
  const usage = done.map(p => p.usageUsd).filter((v): v is number => typeof v === "number");
  return {
    queriesPlanned: cp.plan.length, queriesRun: new Set(cp.pages.map(p => p.q)).size,
    pagesAttempted: cp.pages.length, pagesCompleted: done.length, pagesFailed: cp.pages.filter(p => p.status === "failed").length,
    postsRequested: postsRequested(cp), returned: sum(done, p => p.returned), unmappable: sum(done, p => p.unmappable), duplicates: sum(done, p => p.duplicates), unique: sum(done, p => p.unique),
    qualifiedNew, qualifiedKnown, review, rejected, usageUsd: usage.length ? Math.round(usage.reduce((a, b) => a + b, 0) * 100) / 100 : null,
    perQuery: cp.plan.map((keyword, q) => {
      const pages = done.filter(p => p.q === q);
      return { keyword, pages: pages.length, returned: sum(pages, p => p.returned), unique: sum(pages, p => p.unique), qualified: sum(pages, p => (p.outcomes?.qualified_new ?? 0) + (p.outcomes?.qualified_known ?? 0)), end: queryState(cp, q).ended };
    }),
  };
}

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
/** Discrepancies between the funnel's stages. Empty when it reconciles. */
export function reconcile(f: Funnel): string[] {
  const problems: string[] = [];
  if (f.returned !== f.unmappable + f.duplicates + f.unique) problems.push(`returned ${f.returned} ≠ unmappable ${f.unmappable} + duplicates ${f.duplicates} + unique ${f.unique}`);
  const outcomes = f.qualifiedNew + f.qualifiedKnown + total(f.review) + total(f.rejected);
  if (f.unique !== outcomes) problems.push(`unique ${f.unique} ≠ qualified + review + rejected ${outcomes}`);
  return problems;
}
