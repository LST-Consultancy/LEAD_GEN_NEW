import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/providers/http", async (original) => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
vi.mock("@/lib/ai/complete", async (original) => ({ ...(await original<typeof import("@/lib/ai/complete")>()), complete: vi.fn() }));
import { providerJson } from "@/lib/providers/http";
import { complete } from "@/lib/ai/complete";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { fakeActors } from "./helpers/enrichment-fixture";
import { connectOpportunityProvider, testOpportunityProvider } from "@/lib/services/opportunity-providers";
import { discoverOpportunities } from "@/lib/services/opportunity-ingestion";
import { searchApifyPlatform } from "@/lib/providers/apify-discovery";
import { parseOpportunityQuery } from "@/lib/opportunities/query-parser";
import { offeringSchema, offeringToSearch } from "@/lib/opportunities/offering";
import { createOffering, deleteOffering, listOfferings, offeringSearchPlan, updateOffering } from "@/lib/services/offerings";
import { coveringFilter, jobTerms, mapGooglePage, mapPlace, PLATFORMS, platformConfigSchema, withinWindow } from "@/lib/opportunities/apify-platforms";

// Output shapes as each Actor documents them (docs/provider-contracts.md); values synthetic.
const LI_JOB = { id: "4001", link: "https://www.linkedin.com/jobs/view/4001", title: "NetSuite Implementation Consultant", companyName: "Northwind Synthetic", companyLinkedinUrl: "https://www.linkedin.com/company/northwind-synthetic", companyWebsite: "https://northwind-synthetic.example", companyEmployeesCount: 120, location: "Pune, Maharashtra, India", postedAt: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), descriptionText: "We are hiring a NetSuite consultant to lead our NetSuite implementation.", employmentType: "Full-time", jobPosterName: "Asha Synthetic", jobPosterTitle: "HR Manager" };
const UPWORK_NAMED = { id: "u1", title: "NetSuite implementation partner needed", description: "We need an experienced partner to implement NetSuite for our distribution business.", url: "https://www.upwork.com/jobs/~01synthetic", absoluteDate: new Date(Date.now() - 86400000).toISOString(), clientName: "Contoso Synthetic Pvt Ltd", clientNameConfidence: 0.95, clientLocation: "India", budget: "$5,000", jobType: "fixed", paymentVerified: true };
const UPWORK_HIDDEN = { ...UPWORK_NAMED, id: "u2", url: "https://www.upwork.com/jobs/~02synthetic", clientName: null, clientNameConfidence: null };
const PLACE = { title: "Fabrikam Synthetic Manufacturing", website: "https://fabrikam-synthetic.example/", phone: "+91 20 5555 0100", address: "MIDC, Pune", city: "Pune", state: "Maharashtra", countryCode: "IN", categoryName: "Manufacturer", totalScore: 4.3, reviewsCount: 51, url: "https://www.google.com/maps/place/?q=place_id:synthetic", placeId: "ChIJsynthetic", permanentlyClosed: false, searchString: "manufacturing company" };

const criteria = parseOpportunityQuery("NetSuite implementation in India");
const ctx = { criteria, config: platformConfigSchema.parse({}) };

describe("platform inputs follow each Actor's documented schema", () => {
  it("never picks a date filter narrower than the window, and runs unfiltered beyond the longest one", () => {
    expect(coveringFilter(5, [[1, "a"], [7, "b"], [30, "c"]], "any")).toBe("b");
    expect(coveringFilter(45, [[1, "a"], [7, "b"], [30, "c"]], "any")).toBe("any");
    expect(withinWindow(new Date(Date.now() - 40 * 86400000).toISOString(), 30)).toBe(false);
    expect(withinWindow(null, 30)).toBe(true);
  });
  it("sends Google Search its queries as one newline-separated string, and no resultsPerPage", () => {
    const [run] = PLATFORMS.apify_google_search.plan(ctx);
    expect(typeof run.input.queries).toBe("string");
    expect(run.input).not.toHaveProperty("resultsPerPage");
  });
  it("excludes NSFW and comments on Reddit, and caps pages on the website crawler", () => {
    expect(PLATFORMS.apify_reddit.plan(ctx)[0].input).toMatchObject({ includeNSFW: false, searchComments: false });
    const [w] = PLATFORMS.apify_websites.plan({ criteria, config: platformConfigSchema.parse({ startUrls: ["https://buyer.example/tenders"], maxItemsPerQuery: 10 }) });
    expect(w.input).toMatchObject({ maxCrawlPages: 10, respectRobotsTxtFile: true });
  });
  it("plans nothing it cannot run: Maps without an area, websites without pages", () => {
    expect(PLATFORMS.apify_google_maps.plan({ criteria: { ...criteria, locations: [] }, config: platformConfigSchema.parse({ mapsQueries: ["manufacturing company"] }) })).toEqual([]);
    expect(PLATFORMS.apify_websites.plan(ctx)).toEqual([]);
    expect(jobTerms(criteria, 2).length).toBeLessThanOrEqual(2);
  });
});

describe("mapping results", () => {
  it("maps a LinkedIn job as a job-board posting with the company's site and size", () => {
    expect(PLATFORMS.apify_linkedin_jobs.map(LI_JOB, { ...ctx, query: "NetSuite" })).toMatchObject({ kind: "JOB_BOARD", company: { name: "Northwind Synthetic", domain: "northwind-synthetic.example", employees: 120 }, rawSourceReference: { jobPosterName: "Asha Synthetic" } });
  });
  it("takes an Upwork client's name only when the Actor is confident, and never guesses one", () => {
    expect(PLATFORMS.apify_upwork.map(UPWORK_NAMED, { ...ctx, query: "q" })?.company.name).toBe("Contoso Synthetic Pvt Ltd");
    expect(PLATFORMS.apify_upwork.map(UPWORK_HIDDEN, { ...ctx, query: "q" })?.company.name).toBe("");
  });
  it("never treats a Reddit username as the company", () => {
    const d = PLATFORMS.apify_reddit.map({ id: "r1", url: "https://www.reddit.com/r/Netsuite/comments/1", title: "Need NetSuite partner", body: "Looking for help", username: "someuser", dataType: "post", createdAt: new Date().toISOString() }, { ...ctx, query: "q" });
    expect(d?.company.name).toBe("");
    expect(PLATFORMS.apify_reddit.map({ id: "r2", url: "https://www.reddit.com/r/x/2", title: "t", dataType: "comment" }, { ...ctx, query: "q" })).toBeNull();
  });
  it("splits a Google results page into organic results and recognises LinkedIn posts", () => {
    const docs = mapGooglePage({ searchQuery: { term: "t" }, organicResults: [{ title: "RFP", url: "https://buyer.example/rfp", description: "d", position: 1 }, { title: "Post", url: "https://www.linkedin.com/posts/x_activity-1", description: "d" }] });
    expect(docs.map(d => d.kind)).toEqual(["PUBLIC_WEB", "LINKEDIN_PUBLIC_POST"]);
  });
  it("reads a Maps place as a business, and skips a permanently closed one", () => {
    expect(mapPlace(PLACE)).toMatchObject({ name: "Fabrikam Synthetic Manufacturing", domain: "fabrikam-synthetic.example", category: "Manufacturer" });
    expect(mapPlace({ ...PLACE, permanentlyClosed: true })).toBeNull();
  });
});

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.mocked(providerJson).mockReset();
  vi.mocked(complete).mockReset().mockResolvedValue({ ok: false, code: "not_configured", reason: "No model provider is connected" } as never);
});
async function workspace() {
  vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
  const w = await makeWorkspace("ApifyDiscovery"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  await connectOpportunityProvider(w.ctx, "linkedin_posts", { apiKey: "apify-test-token", config: {}, allowedSearch: true, allowedStorage: true });
  return w;
}
const connect = (w: Awaited<ReturnType<typeof workspace>>, provider: string, config: Record<string, unknown> = {}) => connectOpportunityProvider(w.ctx, provider, { config, allowedSearch: true, allowedStorage: true });
const search = (w: Awaited<ReturnType<typeof workspace>>, providers: string[]) => db.opportunitySearch.create({ data: { workspaceId: w.workspace.id, createdById: w.user.id, query: "NetSuite implementation in India", criteria, providers, idempotencyKey: randomUUID() } });

describe("discovery across platforms", () => {
  it("keeps jobs, buying requests and business prospects apart, on the shared Apify token", async () => {
    const w = await workspace();
    const fake = fakeActors({ "curious_coder/linkedin-jobs-scraper": () => [LI_JOB], "neatrat/upwork-job-scraper": () => [UPWORK_NAMED, UPWORK_HIDDEN], "compass/crawler-google-places": () => [PLACE] });
    vi.mocked(providerJson).mockImplementation(fake.handler as never);
    await connect(w, "apify_linkedin_jobs", { maxQueries: 1 });
    await connect(w, "apify_upwork", { maxQueries: 1 });
    await connect(w, "apify_google_maps", { mapsQueries: ["manufacturing company"], location: "Pune" });
    const s = await search(w, ["apify_linkedin_jobs", "apify_upwork", "apify_google_maps"]);
    const r = await discoverOpportunities(w.workspace.id, s.id);
    expect(r.state).toBe("COMPLETED");
    const opps = await db.opportunity.findMany({ where: { workspaceId: w.workspace.id }, include: { company: true } });
    const job = opps.find(o => o.company.name === "Northwind Synthetic")!;
    expect(job.types).toContain("INTERNAL_HIRING");
    const request = opps.find(o => o.company.name === "Contoso Synthetic Pvt Ltd")!;
    expect(request.types).toContain("EXTERNAL_VENDOR");
    // The Maps place is a prospect company, never an opportunity.
    expect(opps.some(o => o.company.name.startsWith("Fabrikam"))).toBe(false);
    const fabrikam = await db.company.findFirstOrThrow({ where: { workspaceId: w.workspace.id, name: "Fabrikam Synthetic Manufacturing" } });
    expect(fabrikam).toMatchObject({ domain: "fabrikam-synthetic.example", industry: "Manufacturer", country: "India" });
    expect(await db.companyContactPoint.count({ where: { workspaceId: w.workspace.id, companyId: fabrikam.id, kind: "PHONE" } })).toBe(1);
    const results = (await db.opportunitySearch.findUniqueOrThrow({ where: { id: s.id } })).providerResults as Record<string, { status: string; resultClass: string; platformFunnel: Record<string, number>; screened?: Record<string, number> }>;
    expect(results.apify_google_maps).toMatchObject({ resultClass: "business_prospect", platformFunnel: { prospectsCreated: 1 } });
    expect(results.apify_linkedin_jobs.resultClass).toBe("hiring");
    // The Upwork post with a hidden client went to buyer screening, not to a guessed company.
    expect(results.apify_upwork.screened).toMatchObject({ ai_unavailable: 1 });
    // Every platform used the LinkedIn posts token: no platform had its own.
    expect(fake.starts.map(x => x.actor).sort()).toEqual(["compass/crawler-google-places", "curious_coder/linkedin-jobs-scraper", "neatrat/upwork-job-scraper"]);
  });

  it("reads the run it already paid for on a redelivery, instead of starting another", async () => {
    const w = await workspace();
    const fake = fakeActors({ "curious_coder/linkedin-jobs-scraper": () => [LI_JOB] });
    vi.mocked(providerJson).mockImplementation(fake.handler as never);
    const s = await search(w, ["apify_linkedin_jobs"]);
    const run = () => searchApifyPlatform({ workspaceId: w.workspace.id, searchId: s.id, provider: "apify_linkedin_jobs", rawConfig: { maxQueries: 1 }, criteria, key: "apify-test-token" });
    expect((await run()).documents).toHaveLength(1);
    expect((await run()).documents).toHaveLength(1);
    expect(fake.starts).toHaveLength(1);
  });

  it("does not start a query whose estimate exceeds the platform's per-search limit, and says so", async () => {
    const w = await workspace();
    const fake = fakeActors({ "curious_coder/linkedin-jobs-scraper": () => [LI_JOB] });
    vi.mocked(providerJson).mockImplementation(fake.handler as never);
    const s = await search(w, ["apify_linkedin_jobs"]);
    const out = await searchApifyPlatform({ workspaceId: w.workspace.id, searchId: s.id, provider: "apify_linkedin_jobs", rawConfig: { maxQueries: 1, maxItemsPerQuery: 200, maxUsdPerSearch: 0.05 }, criteria, key: "apify-test-token" });
    expect(fake.starts).toHaveLength(0);
    expect(out.notes.join(" ")).toMatch(/was not run: it is estimated at \$0\.400/);
  });

  it("checks the Actor for free when tested, and refuses a platform with no Apify token anywhere", async () => {
    const w = await workspace();
    const fake = fakeActors({});
    vi.mocked(providerJson).mockImplementation(fake.handler as never);
    await connect(w, "apify_naukri");
    expect(await testOpportunityProvider(w.ctx, "apify_naukri")).toMatchObject({ ok: true, message: expect.stringContaining("Nothing was run or charged") });
    expect(fake.starts).toHaveLength(0);
    const bare = await makeWorkspace("ApifyNoToken"); created.workspaceIds.push(bare.workspace.id); created.userIds.push(bare.user.id); created.planIds.push(bare.plan.id);
    await expect(connectOpportunityProvider(bare.ctx, "apify_reddit", { config: {}, allowedSearch: true, allowedStorage: true })).rejects.toThrow(/Apify API token/);
  });
});

describe("offering profiles route queries per platform", () => {
  const offering = { name: "NetSuite for distributors", services: ["NetSuite implementation"], technologies: ["NetSuite"], buyerPhrases: ["looking for a NetSuite partner"], jobTitles: ["NetSuite Administrator"], prospectCategories: ["wholesale distributor"], locations: ["Pune"], negativeKeywords: ["internship"] };
  it("sends buyer phrases to request platforms, job titles to job boards and categories to Maps; industries never filter", () => {
    const { criteria: c, routing } = offeringToSearch(offering);
    expect(c.industries).toEqual([]); expect(c.employeeMin).toBeNull();
    const cfg = platformConfigSchema.parse({ maxQueries: 1 });
    expect(PLATFORMS.apify_linkedin_jobs.plan({ criteria: c, config: cfg, routing })[0].input.keywords).toBe("NetSuite Administrator");
    expect(PLATFORMS.apify_reddit.plan({ criteria: c, config: cfg, routing })[0].input.searches).toEqual(["looking for a NetSuite partner"]);
    expect(PLATFORMS.apify_google_maps.plan({ criteria: c, config: cfg, routing })[0].input).toMatchObject({ searchStringsArray: ["wholesale distributor"], locationQuery: "Pune" });
  });
  it("is scoped to its workspace, soft-deleted, and its routing reaches the Actor input", async () => {
    const w = await workspace(); const other = await workspace();
    const o = await createOffering(w.ctx, offering);
    await expect(updateOffering(other.ctx, o.id, offering)).rejects.toThrow();
    expect(await listOfferings(other.ctx)).toHaveLength(0);
    await connect(w, "apify_indeed", { maxQueries: 1 });
    const plan = await offeringSearchPlan(w.ctx, o.id);
    expect(plan.providers.sort()).toEqual(["apify_indeed", "linkedin_posts"]);
    const fake = fakeActors({ "valig/indeed-jobs-scraper": () => [] });
    vi.mocked(providerJson).mockImplementation(fake.handler as never);
    const s = await db.opportunitySearch.create({ data: { workspaceId: w.workspace.id, createdById: w.user.id, query: plan.query, criteria: plan.criteria, providers: ["apify_indeed"], options: { routing: plan.routing }, idempotencyKey: randomUUID() } });
    await discoverOpportunities(w.workspace.id, s.id);
    expect(fake.starts[0].input).toMatchObject({ title: "NetSuite Administrator", location: "Pune" });
    await deleteOffering(w.ctx, o.id);
    expect(await listOfferings(w.ctx)).toHaveLength(0);
    expect(await db.deletedRecord.count({ where: { workspaceId: w.workspace.id, objectType: "OfferingProfile" } })).toBe(1);
  });
  it("refuses an offering that describes nothing", () => {
    expect(() => offeringSchema.parse({ name: "Empty" })).toThrow(/at least one/);
  });
});
