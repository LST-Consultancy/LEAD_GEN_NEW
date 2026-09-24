import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mapLinkedInPost } from "@/lib/opportunities/linkedin-post";
import { parseOpportunityQuery, type SearchCriteria } from "@/lib/opportunities/query-parser";
import { reconcile, type Funnel } from "@/lib/opportunities/linkedin-run";
import { ProviderRequestError } from "@/lib/providers/provider-errors";

vi.mock("@/lib/providers/http", async (original) => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
vi.mock("@/lib/ai/complete", async (original) => ({ ...(await original<typeof import("@/lib/ai/complete")>()), complete: vi.fn() }));
import { providerJson, validateProviderUrl } from "@/lib/providers/http";
import { complete } from "@/lib/ai/complete";
import { discoveryProvider } from "@/lib/providers/discovery";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { discoverOpportunities } from "@/lib/services/opportunity-ingestion";
import { connectOpportunityProvider } from "@/lib/services/opportunity-providers";
import { cancelOpportunitySearch, getOpportunitySearch, listOpportunities, resumeOpportunitySearch } from "@/lib/services/opportunities";
import { listDiscoveryCandidates, retryDiscoveryAttribution, reviewDiscoveryCandidate } from "@/lib/services/discovery-review";
import { isQueueConfigured } from "@/lib/queue/connection";
import { P, NOW, duplicateOfNamedBuyer, fakeApify, unreadable } from "./helpers/linkedin-fixture";
import type { ActorInput } from "@/lib/providers/linkedin-posts";

const criteria = parseOpportunityQuery("NetSuite implementation");
const legacyPost = { post_url: "https://www.linkedin.com/posts/fictional-cfo_netsuite-activity-1", text: "We are looking for a NetSuite implementation partner to start in Q4. DM me.", posted_at: { date: "2026-09-20 10:00:00", timestamp: Date.UTC(2026, 8, 20, 10) }, author: { name: "Fictional CFO", headline: "CFO at Northwind Traders", profile_url: "https://www.linkedin.com/in/fictional-cfo" } };

// Only Date is faked, so fixture dates are "recent" whatever day the suite runs; timers and I/O are real.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); vi.mocked(providerJson).mockReset(); vi.mocked(complete).mockReset(); });
afterEach(() => vi.useRealTimers());

describe("mapping a scraped post", () => {
  it("reads the common shape, keeps the author and puts the headline in the text", () => {
    const d = mapLinkedInPost(legacyPost, "linkedin_posts", "q")!;
    expect(d).toMatchObject({ kind: "LINKEDIN_PUBLIC_POST", company: { name: "" }, sourceUrl: "https://www.linkedin.com/posts/fictional-cfo_netsuite-activity-1", postedAt: "2026-09-20T10:00:00.000Z", rawSourceReference: { authorName: "Fictional CFO", authorHeadline: "CFO at Northwind Traders" } });
    expect(d.description).toContain("Posted by Fictional CFO, CFO at Northwind Traders");
  });
  it("accepts other common spellings", () => {
    expect(mapLinkedInPost({ postUrl: "https://linkedin.com/feed/update/urn:li:activity:1", content: "Need a NetSuite partner", authorName: "Jo", postedAt: "2026-09-21T00:00:00Z" }, "p", "q")).toMatchObject({ rawSourceReference: { authorName: "Jo" }, postedAt: "2026-09-21T00:00:00.000Z" });
  });
  it("reads a date with no timezone as UTC, not server-local time, and distrusts one in the future", () => {
    expect(mapLinkedInPost({ ...legacyPost, posted_at: "2026-09-20 10:00:00" }, "p", "q")?.postedAt).toBe("2026-09-20T10:00:00.000Z");
    expect(mapLinkedInPost({ ...legacyPost, posted_at: "2027-01-01 10:00:00" }, "p", "q")?.postedAt).toBeNull();
  });
  it("refuses anything that is not a readable LinkedIn post", () => {
    expect(mapLinkedInPost({ ...legacyPost, post_url: "https://evil.invalid/x" }, "p", "q")).toBeNull();
    expect(mapLinkedInPost({ ...legacyPost, text: "" }, "p", "q")).toBeNull();
    expect(mapLinkedInPost("nope", "p", "q")).toBeNull();
  });
});

// ── The Apify adapter ─────────────────────────────────────────────────────────────────────────────
describe("the Apify adapter", () => {
  const adapter = () => discoveryProvider("workspace", "linkedin_posts", {}, "apify-test-token");
  it("starts an asynchronous run per page with the token as a header and manual pagination only", async () => {
    const apify = fakeApify({ pages: i => (i.page_number === 1 ? [legacyPost] : []) });
    vi.mocked(providerJson).mockImplementation(apify.handler);
    expect(await adapter().search(criteria)).toHaveLength(1);
    const [, provider, url, headers, body] = vi.mocked(providerJson).mock.calls[0];
    expect(provider).toBe("linkedin_posts");
    expect(url).toMatch(/^https:\/\/api\.apify\.com\/v2\/acts\/[^/]+\/runs\?timeout=120&maxItems=25&waitForFinish=60$/);
    expect(url).not.toContain("token=");
    expect(headers).toEqual({ Authorization: "Bearer apify-test-token" });
    expect(body).toEqual({ keyword: expect.stringMatching(/^"NetSuite" /), sort_type: "relevance", date_filter: "past-month", limit: 25, page_number: 1 });
    expect(body).not.toHaveProperty("total_posts");
    for (const [, , u] of vi.mocked(providerJson).mock.calls) expect(() => validateProviderUrl(u as string)).not.toThrow();
  });
  it("fails loudly when posts arrive in a format it cannot read, instead of reporting none", async () => {
    vi.mocked(providerJson).mockImplementation(fakeApify({ pages: () => [{ unexpected: true }, { also: "unknown" }] }).handler);
    await expect(adapter().search(criteria)).rejects.toThrow("cannot read");
  });
  it("keeps posts already retrieved when a later request is refused", async () => {
    let started = 0;
    const apify = fakeApify({ pages: () => [legacyPost], failStart: () => (started++ === 0 ? null : new ProviderRequestError("quota", "rate_limited", null, 86400)) });
    vi.mocked(providerJson).mockImplementation(apify.handler);
    await expect(adapter().search(criteria)).rejects.toMatchObject({ documents: [expect.objectContaining({ sourceUrl: legacyPost.post_url })] });
  });
  it("tests the token without paying for a scrape", async () => {
    vi.mocked(providerJson).mockResolvedValue({ data: { id: "u" } });
    expect(await adapter().healthCheck()).toMatchObject({ ok: true });
    expect(vi.mocked(providerJson).mock.calls[0][2]).toBe("https://api.apify.com/v2/users/me");
  });
});

// ── Discovery runs against the test database ─────────────────────────────────────────────────────
const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });

async function workspace(config: Record<string, unknown> = {}) {
  vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
  const w = await makeWorkspace("LinkedInPostFixture"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  await connectOpportunityProvider(w.ctx, "linkedin_posts", { apiKey: "apify-test-token", config, allowedSearch: true, allowedStorage: true });
  return w;
}
const OPTIONS = { depth: "custom", maxQueries: 2, maxPagesPerQuery: 2, postsPerPage: 10, maxPosts: 100, targetQualified: 50 };
async function startSearch(w: Awaited<ReturnType<typeof workspace>>, over: { criteria?: SearchCriteria; options?: Record<string, unknown> } = {}) {
  return db.opportunitySearch.create({ data: { workspaceId: w.workspace.id, createdById: w.user.id, query: "NetSuite implementation", criteria: over.criteria ?? criteria, options: { ...OPTIONS, ...over.options }, providers: ["linkedin_posts"], idempotencyKey: randomUUID() } });
}
/** The mixed fixture: page 1 of query 1 holds every kind of post; its page 2 holds a buyer only found there; query 2 repeats. */
const MIXED = [P.namedBuyer, P.seller, P.jobSeeker, P.vacancy, P.hiresFreelancer, P.recommend, P.informational, P.offTopic, P.old, P.undated];
const mixedPages = (first: () => string) => (i: ActorInput) => i.keyword === first()
  ? (i.page_number === 1 ? MIXED : i.page_number === 2 ? [P.laterPageBuyer, unreadable] : [])
  : (i.page_number === 1 ? [duplicateOfNamedBuyer, P.seller] : []);
/** A model that names a buyer only when the post itself names one. */
function aiNamesWhatIsWritten() {
  vi.mocked(complete).mockImplementation(async (_ctx, req) => {
    const items = JSON.parse(req.prompt) as { i: number; text: string }[];
    const named = items.map(({ i, text }) => text.includes("Northwind Traders") ? { i, buyer: "Northwind Traders", quote: "We are looking for a NetSuite implementation partner" }
      : text.includes("Tailspin Toys") ? { i, buyer: "Tailspin Toys", quote: "Tailspin Toys is ready to start" } : { i, buyer: null, quote: null });
    return { ok: true, text: JSON.stringify(named), model: "claude-haiku-4-5-20251001", provider: "anthropic", inputTokens: 1, outputTokens: 1, latencyMs: 1, estimatedCostInr: 0 };
  });
}
const funnelOfSearch = async (id: string) => ((await db.opportunitySearch.findUniqueOrThrow({ where: { id } })).providerResults as { linkedin_posts: { funnel: Funnel; stop: string; status: string } }).linkedin_posts;

describe("a LinkedIn discovery run", () => {
  it("separates retrieved, unique, qualified, review and rejected posts, and the counts reconcile", async () => {
    const w = await workspace(); const s = await startSearch(w);
    const apify = fakeApify({ pages: mixedPages(() => apify.starts[0].keyword) }); vi.mocked(providerJson).mockImplementation(apify.handler); aiNamesWhatIsWritten();
    expect(await discoverOpportunities(w.workspace.id, s.id)).toMatchObject({ state: "COMPLETED", qualified: 2 });
    const r = await funnelOfSearch(s.id);
    expect(r.stop).toBe("results_exhausted");
    expect(r.funnel).toMatchObject({ queriesRun: 2, pagesCompleted: 3, returned: 14, unmappable: 1, duplicates: 2, unique: 11, qualifiedNew: 2, qualifiedKnown: 0,
      review: { buyer_unresolved: 3 }, rejected: { seller_promotion: 1, job_seeker: 1, internal_hiring: 1, informational: 1, not_relevant: 1, outside_date_window: 1 } });
    expect(reconcile(r.funnel)).toEqual([]);
    // The buyer that only appeared on page 2 was found because page 2 was fetched.
    expect(apify.starts.map(i => i.page_number)).toEqual([1, 1, 2]);
    expect((await listOpportunities(w.ctx, { searchId: s.id })).items.map(o => o.company.name).sort()).toEqual(["Northwind Traders", "Tailspin Toys"]);
    // Nothing was invented: only the two named buyers became companies, and no lead was created.
    expect(await db.company.count({ where: { workspaceId: w.workspace.id } })).toBe(2);
    expect(await db.lead.count({ where: { workspaceId: w.workspace.id } })).toBe(0);
    const view = await getOpportunitySearch(w.ctx, s.id);
    expect(view).toMatchObject({ needsReview: 3, rejected: 6, retryPending: 0, crmLeads: 0 });
    const review = await listDiscoveryCandidates(w.ctx, { searchId: s.id });
    expect(review.find(c => c.suggestedBuyer === "Contoso Retail")).toMatchObject({ reason: "buyer_unresolved", classification: "buying", evidence: expect.objectContaining({ quote: expect.stringContaining("hiring a freelance NetSuite consultant") }) });
    expect(review.find(c => c.title.startsWith("We need a NetSuite consultant"))?.evidence).toMatchObject({ reviewReasons: ["buyer_unresolved", "date_unknown"] });
    const rejected = await listDiscoveryCandidates(w.ctx, { searchId: s.id, status: "REJECTED", reason: "internal_hiring" });
    expect(rejected).toHaveLength(1);
  });

  it("is idempotent: a repeat search finds the same opportunities as already known and duplicates nothing", async () => {
    const w = await workspace(); aiNamesWhatIsWritten();
    for (const expectKnown of [false, true]) {
      const s = await startSearch(w);
      const apify = fakeApify({ pages: mixedPages(() => apify.starts[0].keyword) }); vi.mocked(providerJson).mockImplementation(apify.handler);
      await discoverOpportunities(w.workspace.id, s.id);
      vi.setSystemTime(NOW + 60_000);
      expect((await funnelOfSearch(s.id)).funnel).toMatchObject(expectKnown ? { qualifiedNew: 0, qualifiedKnown: 2 } : { qualifiedNew: 2, qualifiedKnown: 0 });
      expect(await discoverOpportunities(w.workspace.id, s.id)).toMatchObject({ skipped: true }); // a redelivered job does nothing
    }
    expect(await db.opportunity.count({ where: { workspaceId: w.workspace.id } })).toBe(2);
    expect(await db.opportunitySource.count({ where: { workspaceId: w.workspace.id } })).toBe(2);
  });

  it("keeps buying posts for a retryable check when the AI fails, then qualifies them on retry", async () => {
    const w = await workspace(); const s = await startSearch(w);
    const apify = fakeApify({ pages: mixedPages(() => apify.starts[0].keyword) }); vi.mocked(providerJson).mockImplementation(apify.handler);
    vi.mocked(complete).mockResolvedValue({ ok: false, reason: "not_configured", message: "No AI provider" } as never);
    expect(await discoverOpportunities(w.workspace.id, s.id)).toMatchObject({ state: "COMPLETED", qualified: 0 });
    expect((await funnelOfSearch(s.id)).funnel).toMatchObject({ unique: 11, review: { ai_unavailable: 5 } });
    expect(await getOpportunitySearch(w.ctx, s.id)).toMatchObject({ needsReview: 5, retryPending: 5 });
    aiNamesWhatIsWritten();
    expect(await retryDiscoveryAttribution(w.ctx, s.id)).toMatchObject({ attempted: 5, remaining: 0, outcomes: { qualified_new: 2, "review:buyer_unresolved": 3 } });
    expect(await getOpportunitySearch(w.ctx, s.id)).toMatchObject({ qualified: 2, needsReview: 3, retryPending: 0, retries: [expect.objectContaining({ attempted: 5 })] });
  });

  it("stops on a rate limit with partial results kept, and resumes without paying for finished pages again", async () => {
    const w = await workspace(); const s = await startSearch(w); aiNamesWhatIsWritten();
    let limited = true;
    const apify = fakeApify({ pages: mixedPages(() => apify.starts[0].keyword), failStart: i => (limited && i.page_number === 2 ? new ProviderRequestError("hourly", "rate_limited", null, 3600) : null) });
    vi.mocked(providerJson).mockImplementation(apify.handler);
    expect(await discoverOpportunities(w.workspace.id, s.id)).toMatchObject({ state: "PARTIAL", qualified: 1 });
    expect(await funnelOfSearch(s.id)).toMatchObject({ status: "PARTIAL", stop: "rate_limited" });
    expect(await getOpportunitySearch(w.ctx, s.id)).toMatchObject({ state: "PARTIAL", resumable: true });
    limited = false;
    if (isQueueConfigured()) await resumeOpportunitySearch(w.ctx, s.id);
    else await db.opportunitySearch.update({ where: { id: s.id }, data: { state: "QUEUED", finishedAt: null } });
    expect(await discoverOpportunities(w.workspace.id, s.id)).toMatchObject({ state: "COMPLETED", qualified: 2 });
    expect(apify.starts).toHaveLength(3); // page 1 of each query once, then the refused page — nothing re-bought
    const r = await funnelOfSearch(s.id);
    expect(r.funnel).toMatchObject({ unique: 11, qualifiedNew: 2 }); expect(reconcile(r.funnel)).toEqual([]);
  });

  it("finds a run whose start reply was lost instead of starting and paying for it twice", async () => {
    const w = await workspace(); const s = await startSearch(w, { options: { maxQueries: 1, maxPagesPerQuery: 1 } }); aiNamesWhatIsWritten();
    const apify = fakeApify({ pages: () => [P.namedBuyer], pollsUntilDone: 2, loseReply: (_i, attempt) => (attempt === 1 ? new ProviderRequestError("lost", "network") : null) });
    vi.mocked(providerJson).mockImplementation(apify.handler);
    expect(await discoverOpportunities(w.workspace.id, s.id)).toMatchObject({ state: "COMPLETED", qualified: 1 });
    expect(apify.runs.size).toBe(1);
    expect(apify.calls).toContain(`GET /v2/key-value-stores/kv-run1/records/INPUT`);
  });

  it("keeps a relevant post with unknown company details for review, rejects it only under strict filters, and lets a reviewer qualify it", async () => {
    const us = parseOpportunityQuery("NetSuite implementation in US companies"); aiNamesWhatIsWritten();
    const w = await workspace();
    const onePage = () => fakeApify({ pages: i => (i.page_number === 1 ? [P.namedBuyer] : []) });
    vi.mocked(providerJson).mockImplementation(onePage().handler);
    const lenient = await startSearch(w, { criteria: us, options: { maxQueries: 1 } });
    await discoverOpportunities(w.workspace.id, lenient.id);
    expect((await funnelOfSearch(lenient.id)).funnel).toMatchObject({ qualifiedNew: 0, review: { filter_unknown: 1 } });
    const [candidate] = await listDiscoveryCandidates(w.ctx, { searchId: lenient.id });
    expect(candidate).toMatchObject({ suggestedBuyer: "Northwind Traders", evidence: expect.objectContaining({ filters: [expect.objectContaining({ field: "location", state: "unknown" })] }) });
    await expect(reviewDiscoveryCandidate(w.ctx, candidate.id, { action: "qualify", company: "Northwind Traders", country: "Germany" })).rejects.toMatchObject({ status: 422 });
    const ok = await reviewDiscoveryCandidate(w.ctx, candidate.id, { action: "qualify", company: "Northwind Traders" });
    const source = await db.opportunitySource.findFirstOrThrow({ where: { workspaceId: w.workspace.id, opportunityId: ok.opportunityId! } });
    expect(source.rawReference).toMatchObject({ qualification: { confirmedByReviewer: true, filters: [expect.objectContaining({ state: "unknown" })] } });

    vi.mocked(providerJson).mockImplementation(onePage().handler);
    const strict = await startSearch(w, { criteria: us, options: { maxQueries: 1, strictFilters: true } });
    await discoverOpportunities(w.workspace.id, strict.id);
    expect((await funnelOfSearch(strict.id)).funnel).toMatchObject({ review: {}, rejected: { filter_unknown_strict: 1 } });
  });

  it("cancels a queued search before anything is fetched, and a running one between pages", async () => {
    const w = await workspace(); aiNamesWhatIsWritten();
    const queued = await startSearch(w);
    expect(await cancelOpportunitySearch(w.ctx, queued.id)).toMatchObject({ state: "CANCELLED" });
    vi.mocked(providerJson).mockImplementation(fakeApify({ pages: () => MIXED }).handler);
    expect(await discoverOpportunities(w.workspace.id, queued.id)).toMatchObject({ skipped: true });
    expect(vi.mocked(providerJson)).not.toHaveBeenCalled();

    const running = await startSearch(w);
    const apify = fakeApify({ pages: i => (i.page_number === 1 ? MIXED : []) });
    // Someone presses Cancel while the first page is being read.
    vi.mocked(providerJson).mockImplementation(async (...args) => {
      const reply = await apify.handler(...(args as Parameters<typeof apify.handler>));
      if (String(args[2]).includes("/datasets/")) await db.opportunitySearch.update({ where: { id: running.id }, data: { cancelRequestedAt: new Date() } });
      return reply;
    });
    expect(await discoverOpportunities(w.workspace.id, running.id)).toMatchObject({ state: "CANCELLED" });
    expect(apify.starts).toHaveLength(1);
    expect((await funnelOfSearch(running.id)).funnel).toMatchObject({ pagesCompleted: 1, unique: 10 });
  });
});
