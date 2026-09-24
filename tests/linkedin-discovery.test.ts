import { describe, expect, it } from "vitest";
import { parseOpportunityQuery } from "@/lib/opportunities/query-parser";
import { effectivePlan, linkedInDateWindow, planLinkedInQueries, relevanceTerms, resolveOptions, DEPTHS } from "@/lib/opportunities/linkedin-plan";
import { classifyPost, decidePost, suggestBuyerFromHeadline, checkFilters } from "@/lib/opportunities/linkedin-qualify";
import { freshCheckpoint, funnelOf, PageFetchError, reconcile, runLinkedInPlan, type Outcome, type RunDeps, type RunCheckpoint } from "@/lib/opportunities/linkedin-run";
import { explainRun } from "@/lib/opportunities/linkedin-explain";
import { linkedInPostKey, mapLinkedInPost } from "@/lib/opportunities/linkedin-post";
import type { SourceDocument } from "@/lib/opportunities/extractor";
import { P, NOW, duplicateOfNamedBuyer, filler, unreadable } from "./helpers/linkedin-fixture";

const netsuite = parseOpportunityQuery("NetSuite implementation");
const doc = (item: unknown) => mapLinkedInPost(item, "linkedin_posts", "q")!;
const decide = (item: unknown, criteria = netsuite, strict = false) => decidePost(doc(item), criteria, { terms: relevanceTerms(criteria), now: new Date(NOW), strict });

describe("the LinkedIn query planner", () => {
  it("searches every named subject before repeating one, and every intent expression before repeating one", () => {
    const criteria = parseOpportunityQuery("looking for a partner salesforce or Netsuite or HubSpot");
    const plan = planLinkedInQueries(criteria, 6);
    expect(new Set(plan.slice(0, 3).map(p => p.subject))).toEqual(new Set(["Salesforce", "NetSuite", "HubSpot"]));
    expect(new Set(plan.map(p => p.intent)).size).toBe(6);
  });
  it("reaches aliases at the default depth instead of leaving them past the truncation point", () => {
    const plan = planLinkedInQueries(netsuite, DEPTHS.standard.maxQueries);
    expect(plan.map(p => p.subject)).toEqual(expect.arrayContaining(["NetSuite", "Oracle NetSuite", "SuiteScript"]));
    expect(plan.map(p => p.intent)).toEqual(expect.arrayContaining(["looking_for", "need_help", "recommend", "vendor", "rfp", "hire_external"]));
  });
  it("stays on the subject asked for: no generic ERP or developer-job terms", () => {
    const keywords = planLinkedInQueries(netsuite, 24).map(p => p.keyword).join(" ");
    expect(keywords).not.toMatch(/\bERP\b|developer jobs|"developer"/i);
    for (const p of planLinkedInQueries(netsuite, 24)) expect(p.keyword).toMatch(/^"(NetSuite|Oracle NetSuite|SuiteScript)"/);
  });
  it("uses LinkedIn's own syntax: quoted subjects, OR groups, NOT for exclusions", () => {
    const [first] = planLinkedInQueries({ ...netsuite, negativeKeywords: ["jobs"] }, 1);
    expect(first.keyword).toBe('"NetSuite" ("looking for" OR "seeking" OR "searching for") (consultant OR partner OR "implementation partner") NOT "jobs"');
  });
  it("finds the subject of a query no vocabulary pack knows", () => {
    expect(planLinkedInQueries(parseOpportunityQuery("Web Application Development"), 1)[0].subject).toBe("Web Application");
    expect(planLinkedInQueries(parseOpportunityQuery("Odoo implementation in US companies"), 1)[0].subject).toBe("Odoo");
  });
  it("sends a person's edited queries verbatim instead of the generated ones", () => {
    expect(effectivePlan(netsuite, { maxQueries: 8, queries: ['"NetSuite" RFP', '"NetSuite" RFP'] }).map(p => p.keyword)).toEqual(['"NetSuite" RFP']);
  });
  it("caps a member's budget at the workspace ceiling and says so", () => {
    expect(resolveOptions({ depth: "custom", maxPosts: 900 }, 300)).toMatchObject({ maxPosts: 300, cappedBy: 300 });
    expect(resolveOptions({ depth: "custom", maxPosts: 100 }, 300)).toMatchObject({ maxPosts: 100, cappedBy: null });
    expect(resolveOptions({ depth: "bogus" }, 500)).toMatchObject({ depth: "standard", maxPosts: DEPTHS.standard.maxPosts });
  });
});

describe("the requested date window", () => {
  it("uses the narrowest provider filter that still contains the window, never a shorter one", () => {
    expect(linkedInDateWindow(1)).toMatchObject({ filter: "past-24h", note: null });
    expect(linkedInDateWindow(7)).toMatchObject({ filter: "past-week", note: null });
    expect(linkedInDateWindow(14)).toMatchObject({ filter: "past-month", sort: "relevance" });
    expect(linkedInDateWindow(14).note).toContain("older than 14 days are discarded");
  });
  it("runs unfiltered and newest-first beyond a month, and says coverage there is not guaranteed", () => {
    const w = linkedInDateWindow(90);
    expect(w).toMatchObject({ filter: "", sort: "date_posted" });
    expect(w.note).toMatch(/past month at most.*not guaranteed/);
  });
  it("rejects a post from before the window and keeps an undated one for review", () => {
    expect(decide(P.old)).toMatchObject({ outcome: "rejected", reason: "outside_date_window" });
    expect(decide(P.undated)).toMatchObject({ outcome: "candidate", review: ["date_unknown"] });
    expect(decide(P.old, { ...netsuite, dateRange: { days: 90 } })).toMatchObject({ outcome: "candidate" });
  });
});

describe("classifying a post", () => {
  it.each([
    [P.namedBuyer, "buying"], [P.seller, "seller_promotion"], [P.jobSeeker, "job_seeker"], [P.vacancy, "internal_hiring"],
    [P.hiresFreelancer, "buying"], [P.recommend, "buying"], [P.informational, "informational"],
  ])("%#", (item, kind) => expect(classifyPost(doc(item).description).kind).toBe(kind));
  it("does not reject every post that says hiring: hiring a freelancer is a purchase", () => {
    expect(decide(P.hiresFreelancer)).toMatchObject({ outcome: "candidate" });
    expect(decide(P.vacancy)).toMatchObject({ outcome: "rejected", reason: "internal_hiring" });
  });
  it("records the phrase that decided it", () => {
    expect(decide(P.recommend).evidence.quote).toContain("Can anyone recommend a NetSuite consultant");
    expect(decide(P.seller).evidence.quote).toMatch(/We help|Looking for a NetSuite partner\?/);
  });
  it("counts an off-topic post as off topic, not as a seller or a job", () => {
    expect(decide(P.offTopic)).toMatchObject({ outcome: "rejected", reason: "not_relevant" });
  });
  it("offers an employer from the headline only as a suggestion, and not from a recruiter or consultant", () => {
    expect(suggestBuyerFromHeadline("Head of Finance at Contoso Retail")).toBe("Contoso Retail");
    expect(suggestBuyerFromHeadline("Senior Recruiter at Hays")).toBeNull();
    expect(suggestBuyerFromHeadline("NetSuite Consultant at Big Four")).toBeNull();
  });
});

describe("filters with unknown company details", () => {
  const us = { ...netsuite, locations: ["United States"], employeeMin: 50, employeeMax: 500 };
  it("keeps a relevant post whose company details are unknown in review, marked unknown rather than matched", () => {
    const d = decide(P.namedBuyer, us);
    expect(d).toMatchObject({ outcome: "candidate", review: ["filter_unknown"] });
    expect(d.evidence.filters.map(f => f.state)).toEqual(["unknown", "unknown"]);
  });
  it("rejects on unknown only under strict filters, with a reason distinct from a known mismatch", () => {
    expect(decide(P.namedBuyer, us, true)).toMatchObject({ outcome: "rejected", reason: "filter_unknown_strict" });
    const known = { ...doc(P.namedBuyer), company: { name: "", country: "Germany", employees: 40 } };
    expect(decidePost(known, us, { terms: relevanceTerms(us), now: new Date(NOW), strict: false })).toMatchObject({ outcome: "rejected", reason: "filter_mismatch" });
    expect(checkFilters(known, us).map(f => f.state)).toEqual(["mismatch", "mismatch"]);
  });
});

describe("post identity", () => {
  it("gives one post the same key under its /posts/ and /feed/update/ URLs", () => {
    expect(linkedInPostKey(P.namedBuyer, P.namedBuyer.post_url)).toBe(linkedInPostKey(duplicateOfNamedBuyer, duplicateOfNamedBuyer.post_url));
  });
  it("strips tracking parameters from the stored URL", () => {
    expect(doc(P.namedBuyer).sourceUrl).not.toMatch(/\?|utm|trk/);
  });
});

// ── The run engine, with every side effect faked ──────────────────────────────────────────────────
type Page = unknown[];
function harness(pages: Record<string, Page[]>, o: { outcome?: (d: SourceDocument) => Outcome; fail?: (kw: string, page: number, attempt: number) => PageFetchError | Error | null; cancelAfter?: number; clockStep?: number; crashOnProcess?: (kw: string, page: number) => boolean } = {}) {
  let clock = NOW; let pagesFetched = 0; let starts = 0; const attempts = new Map<string, number>(); const saved: RunCheckpoint[] = [];
  const deps: RunDeps = {
    fetchPage: async ({ keyword, page, limit, record, onStarted }) => {
      const key = `${keyword}#${page}`; const attempt = (attempts.get(key) ?? 0) + 1; attempts.set(key, attempt);
      clock += o.clockStep ?? 1000;
      if (!record.runId) { const err = o.fail?.(keyword, page, attempt); if (err) throw err; starts++; await onStarted(`run-${key}`); }
      pagesFetched++;
      return { items: (pages[keyword]?.[page - 1] ?? []).slice(0, limit), runId: record.runId ?? `run-${key}` };
    },
    mapItem: item => mapLinkedInPost(item, "linkedin_posts", "q"),
    keyOf: d => String(d.rawSourceReference.postKey),
    processDocs: async (docs, at) => { if (o.crashOnProcess?.(at.keyword, at.page)) throw new Error("worker died"); return docs.map(d => o.outcome?.(d) ?? "rejected:informational"); },
    save: async cp => { saved.push(structuredClone(cp)); },
    cancelled: async () => o.cancelAfter !== undefined && pagesFetched >= o.cancelAfter,
    now: () => clock,
  };
  return { deps, get pagesFetched() { return pagesFetched; }, get starts() { return starts; }, saved };
}
const opts = { maxPagesPerQuery: 3, postsPerPage: 10, maxPosts: 1000, targetQualified: 100, maxRuntimeSec: 600 };
const win = { days: 30, sort: "relevance" as const };
const isBuyer = (d: SourceDocument) => (/looking for|recommend|hiring a freelance/i.test(d.description) ? "qualified_new" : "rejected:informational") as Outcome;

describe("paginating a plan", () => {
  it("finds relevant posts that only appear on a later page", async () => {
    const h = harness({ a: [filler(10, "a1"), [P.laterPageBuyer, ...filler(9, "a2")]] }, { outcome: isBuyer });
    const cp = await runLinkedInPlan(freshCheckpoint(["a"], NOW), opts, win, h.deps);
    expect(funnelOf(cp)).toMatchObject({ pagesCompleted: 3, qualifiedNew: 1 });
    expect(cp.pages.find(p => p.page === 2)?.outcomes).toMatchObject({ qualified_new: 1 });
  });
  it("walks page 1 of every query before any page 2", async () => {
    const order: string[] = [];
    const h = harness({ a: [filler(10, "a1"), filler(10, "a2")], b: [filler(10, "b1"), filler(10, "b2")] });
    const fetch = h.deps.fetchPage; h.deps.fetchPage = async args => { order.push(`${args.keyword}${args.page}`); return fetch(args); };
    await runLinkedInPlan(freshCheckpoint(["a", "b"], NOW), { ...opts, maxPagesPerQuery: 2 }, win, h.deps);
    expect(order).toEqual(["a1", "b1", "a2", "b2"]);
  });
  it("counts a post found by two queries or two pages once, and the funnel reconciles", async () => {
    const h = harness({ a: [[P.namedBuyer, ...filler(9, "a")]], b: [[duplicateOfNamedBuyer, unreadable, P.recommend, ...filler(7, "b")]] }, { outcome: isBuyer });
    const f = funnelOf(await runLinkedInPlan(freshCheckpoint(["a", "b"], NOW), { ...opts, maxPagesPerQuery: 1 }, win, h.deps));
    expect(f).toMatchObject({ returned: 20, duplicates: 1, unmappable: 1, unique: 18, qualifiedNew: 2 });
    expect(reconcile(f)).toEqual([]);
  });
  it("stops a query whose next page repeats the last one, and one whose page is well short", async () => {
    const same = filler(10, "same");
    const h = harness({ a: [same, same, filler(10, "never")], b: [filler(3, "short"), filler(10, "never-b")] });
    const cp = await runLinkedInPlan(freshCheckpoint(["a", "b"], NOW), opts, win, h.deps);
    expect(funnelOf(cp).perQuery.map(q => q.end)).toEqual(["repeated_page", "exhausted"]);
    expect(h.pagesFetched).toBe(3);
    expect(cp.stop).toBe("results_exhausted");
  });
  it("stops a query that returns only posts other queries already found", async () => {
    const shared = filler(10, "shared");
    const cp = await runLinkedInPlan(freshCheckpoint(["a", "b"], NOW), opts, win, harness({ a: [shared, filler(2, "a2")], b: [shared, filler(10, "b2")] }).deps);
    expect(funnelOf(cp).perQuery[1].end).toBe("no_new_results");
  });
  it("reports depth reached, not exhaustion, when queries were still producing at the page limit", async () => {
    const cp = await runLinkedInPlan(freshCheckpoint(["a"], NOW), { ...opts, maxPagesPerQuery: 1 }, win, harness({ a: [filler(10, "a"), filler(10, "more")] }).deps);
    expect(cp.stop).toBe("depth_limit");
  });
  it("stops walking a newest-first query once its posts are older than the window", async () => {
    const cp = await runLinkedInPlan(freshCheckpoint(["a"], NOW), opts, { days: 30, sort: "date_posted" }, harness({ a: [[P.old, ...filler(9, "x")], filler(10, "never")] }).deps);
    expect(funnelOf(cp).perQuery[0]).toMatchObject({ pages: 1, end: "date_window_end" });
  });
});

describe("the limits of a run", () => {
  it("stops at the qualified target, best effort", async () => {
    const buyers = Array.from({ length: 10 }, (_, i) => ({ ...P.namedBuyer, urn: `urn:li:activity:7400000000000${String(i).padStart(6, "0")}`, post_url: `https://www.linkedin.com/posts/b-${i}` }));
    const h = harness({ a: [buyers], b: [buyers.map((b, i) => ({ ...b, urn: `urn:li:activity:7500000000000${String(i).padStart(6, "0")}`, post_url: `https://www.linkedin.com/posts/c-${i}` }))] }, { outcome: () => "qualified_new" });
    const cp = await runLinkedInPlan(freshCheckpoint(["a", "b"], NOW), { ...opts, targetQualified: 5 }, win, h.deps);
    expect(cp.stop).toBe("target_reached"); expect(h.pagesFetched).toBe(1);
  });
  it("never asks for more posts than the budget has left, and stops when a page would be too small", async () => {
    const h = harness({ a: [filler(10, "a1"), filler(10, "a2")], b: [filler(10, "b1")] });
    const limits: number[] = []; const fetch = h.deps.fetchPage; h.deps.fetchPage = async args => { limits.push(args.limit); return fetch(args); };
    const cp = await runLinkedInPlan(freshCheckpoint(["a", "b"], NOW), { ...opts, maxPosts: 25 }, win, h.deps);
    expect(limits).toEqual([10, 10]); expect(cp.stop).toBe("budget_posts");
    expect(funnelOf(cp).postsRequested).toBeLessThanOrEqual(25);
  });
  it("stops at the runtime limit", async () => {
    const cp = await runLinkedInPlan(freshCheckpoint(["a", "b", "c"], NOW), { ...opts, maxRuntimeSec: 60 }, win, harness({ a: [filler(10, "a")], b: [filler(10, "b")], c: [filler(10, "c")] }, { clockStep: 45_000 }).deps);
    expect(cp.stop).toBe("budget_runtime"); expect(funnelOf(cp).pagesCompleted).toBe(2);
  });
  it("stops between pages when cancelled and keeps what it already processed", async () => {
    const cp = await runLinkedInPlan(freshCheckpoint(["a", "b"], NOW), opts, win, harness({ a: [filler(10, "a")], b: [filler(10, "b")] }, { cancelAfter: 1 }).deps);
    expect(cp.stop).toBe("cancelled"); expect(funnelOf(cp)).toMatchObject({ pagesCompleted: 1, unique: 10 });
  });
  it("stops on a rate limit and keeps earlier pages", async () => {
    const h = harness({ a: [filler(10, "a")], b: [filler(10, "b")] }, { fail: kw => (kw === "b" ? new PageFetchError("limited", "rate_limited") : null) });
    const cp = await runLinkedInPlan(freshCheckpoint(["a", "b"], NOW), opts, win, h.deps);
    expect(cp.stop).toBe("rate_limited"); expect(funnelOf(cp)).toMatchObject({ pagesCompleted: 1, unique: 10, pagesFailed: 1 });
  });
  it("retries a transient page failure once, then gives up on that query without losing the others", async () => {
    const h = harness({ a: [filler(3, "a")], b: [filler(3, "b")] }, { fail: kw => (kw === "a" ? new Error("503") : null) });
    const cp = await runLinkedInPlan(freshCheckpoint(["a", "b"], NOW), opts, win, h.deps);
    expect(funnelOf(cp).perQuery.map(q => q.end)).toEqual(["provider_error", "exhausted"]);
    expect(cp.pages.find(p => p.q === 0)?.attempts).toBe(2);
  });
});

describe("resuming", () => {
  it("resumes after a crash without re-fetching finished pages or restarting a started run", async () => {
    const pages = { a: [filler(10, "a1"), filler(3, "a2")], b: [filler(3, "b1")] };
    const first = harness(pages, { crashOnProcess: (kw, page) => kw === "b" && page === 1 });
    await expect(runLinkedInPlan(freshCheckpoint(["a", "b"], NOW), opts, win, first.deps)).rejects.toThrow("worker died");
    const checkpoint = first.saved.at(-1)!;
    expect(checkpoint.pages.find(p => p.q === 1)).toMatchObject({ status: "started", runId: "run-b#1" });
    const second = harness(pages);
    const fetched: string[] = []; const fetch = second.deps.fetchPage; second.deps.fetchPage = async args => { fetched.push(`${args.keyword}${args.page}:${args.resumed ? "resumed" : "new"}`); return fetch(args); };
    const cp = await runLinkedInPlan(checkpoint, opts, win, second.deps);
    expect(fetched).toEqual(["b1:resumed", "a2:new"]);
    expect(second.starts).toBe(1); // only a2 was started; b1 was read from its recorded run
    expect(funnelOf(cp)).toMatchObject({ unique: 16, pagesCompleted: 3 });
    expect(reconcile(funnelOf(cp))).toEqual([]);
  });
});

describe("explaining a low-result run", () => {
  it("says only what the counts show", () => {
    const h = harness({ a: [[P.seller, P.seller, P.recommend]] }, { outcome: d => (/We help/.test(d.description) ? "rejected:seller_promotion" : "review:buyer_unresolved") });
    return runLinkedInPlan(freshCheckpoint(["a"], NOW), opts, win, h.deps).then(cp => {
      const lines = explainRun(funnelOf(cp), cp.stop!, { targetQualified: 10, maxPosts: 200 });
      expect(lines.join(" ")).toMatch(/1 relevant post needs a person to confirm it/);
      expect(lines.join(" ")).toMatch(/ran out of new results/);
      expect(lines.join(" ")).not.toMatch(/depth/);
    });
  });
});
