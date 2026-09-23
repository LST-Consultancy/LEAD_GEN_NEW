import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { screenUnattributed, verifyBuyer, parseBuyerReply } from "@/lib/opportunities/buyer";
import { webQueryTerms } from "@/lib/opportunities/web-queries";
import { extractOpportunity, type SourceDocument } from "@/lib/opportunities/extractor";
import { parseOpportunityQuery } from "@/lib/opportunities/query-parser";

vi.mock("@/lib/ai/complete", async (original) => ({ ...(await original<typeof import("@/lib/ai/complete")>()), complete: vi.fn() }));
vi.mock("@/lib/providers/http", () => ({ providerJson: vi.fn() }));
import { complete } from "@/lib/ai/complete";
import { providerJson } from "@/lib/providers/http";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { resolveBuyers, discoverOpportunities } from "@/lib/services/opportunity-ingestion";
import { connectOpportunityProvider } from "@/lib/services/opportunity-providers";

const criteria = parseOpportunityQuery("NetSuite implementation");
const page = (over: Partial<SourceDocument>): SourceDocument => ({ provider: "brave", kind: "PUBLIC_WEB", externalId: over.sourceUrl ?? "https://fixture.invalid/x", sourceUrl: "https://fixture.invalid/x", title: "", description: "", company: { name: "" }, postedAt: null, rawSourceReference: {}, status: "UNKNOWN", ...over });
const screen = (d: SourceDocument) => screenUnattributed(d, extractOpportunity(d, criteria));
const ok = (text: string) => ({ ok: true as const, text, model: "claude-haiku-4-5-20251001", provider: "anthropic" as const, inputTokens: 1, outputTokens: 1, latencyMs: 1, estimatedCostInr: 0 });

describe("rule-based screening", () => {
  it("sets aside the seller and publisher pages a bare technology search returns", () => {
    for (const d of [
      page({ title: "10 Best NetSuite Implementation Partners for 2026", description: "Compare the top partners to implement NetSuite ERP for your business." }),
      page({ title: "NetSuite Implementation Guide for Controllers", description: "Everything you need to plan a NetSuite implementation." }),
      page({ title: "NetSuite Consulting Services", description: "We help mid-market companies implement NetSuite. Book a call with our certified NetSuite consultants." }),
    ]) expect(screen(d)).toMatchObject({ verdict: "drop" });
  });
  it("sets aside the pages a live search wrongly kept: an article about RFPs, a directory and job adverts", () => {
    expect(screen(page({ sourceUrl: "https://closeloop.com/blog/checklist", title: "What Makes a Great NetSuite Implementation Company? Buyer's Checklist", description: "Before you issue an RFP for NetSuite implementation, use this request for proposal checklist.", rawSourceReference: { siteName: "Closeloop" } }))).toMatchObject({ verdict: "drop" });
    expect(screen(page({ sourceUrl: "https://www.designrush.com/agency/it-services/netsuite", title: "Top NetSuite Consultants in 2026", description: "Looking for a NetSuite implementation partner? Browse agencies." }))).toEqual({ verdict: "drop", reason: "seller_or_publisher" });
    expect(screen(page({ sourceUrl: "https://www.dreamworkhq.com/job/1", title: "Solutions Architect (Remote) at Bryantparkconsulting | Dreamwork", description: "We are hiring a NetSuite implementation architect." }))).toEqual({ verdict: "drop", reason: "hiring_only" });
    expect(screen(page({ sourceUrl: "https://earnbetter.com/app/job/1", title: "Netsuite Financials Consultant in Tampa, FL", description: "Deloitte is hiring a Netsuite Financials Consultant to support the design, implementation, and deployment of NetSuite solutions for clients." }))).toEqual({ verdict: "drop", reason: "hiring_only" });
  });
  it("drops off-topic and non-request pages", () => {
    expect(screen(page({ title: "Quarterly results", description: "Revenue grew." }))).toEqual({ verdict: "drop", reason: "not_relevant" });
  });
  it("names the page owner when a company's own site asks for a provider", () => {
    const d = page({ sourceUrl: "https://www.fictional-buyer.invalid/procurement/rfp-12", title: "Request for Proposal: NetSuite implementation", description: "Fictional Buyer Ltd invites proposals from partners for a NetSuite implementation.", rawSourceReference: { siteName: "Fictional Buyer" } });
    expect(screen(d)).toEqual({ verdict: "resolved", company: { name: "Fictional Buyer", domain: "fictional-buyer.invalid" }, attribution: { method: "page_owner", host: "fictional-buyer.invalid" } });
  });
  it("never treats the host of other people's words as the buyer, and lets a buyer phrase outweigh a seller phrase", () => {
    const d = page({ sourceUrl: "https://www.reddit.com/r/Netsuite/abc", title: "We are looking for a NetSuite implementation partner", description: "Contact us if you can help. We are looking for a NetSuite implementation partner in Ohio." });
    expect(screen(d)).toEqual({ verdict: "ask_ai" });
  });
});

describe("verifying a model's proposed buyer", () => {
  const d = page({ title: "Tender notice", description: "Northwind Traders is inviting proposals for a NetSuite implementation partner by March." });
  it("accepts a name and quote that literally appear in the text", () => {
    expect(verifyBuyer(d, criteria, { buyer: "Northwind Traders", quote: "inviting proposals for a NetSuite implementation partner" })).toEqual({ name: "Northwind Traders", quote: "inviting proposals for a NetSuite implementation partner" });
  });
  it("refuses a name that is not in the text, a paraphrased quote, or the technology itself", () => {
    expect(verifyBuyer(d, criteria, { buyer: "Contoso", quote: "inviting proposals for a NetSuite implementation partner" })).toBeNull();
    expect(verifyBuyer(d, criteria, { buyer: "Northwind Traders", quote: "wants a NetSuite partner soon" })).toBeNull();
    expect(verifyBuyer(d, criteria, { buyer: "NetSuite", quote: "inviting proposals for a NetSuite implementation partner" })).toBeNull();
    expect(verifyBuyer(d, criteria, { buyer: null, quote: null })).toBeNull();
  });
  it("tolerates a malformed reply", () => {
    expect(parseBuyerReply("not json")).toEqual([]);
    expect(parseBuyerReply('```json\n[{"i":0,"buyer":"A","quote":"b"},{"x":1}]\n```')).toEqual([{ i: 0, buyer: "A", quote: "b" }]);
  });
});

describe("web queries", () => {
  it("phrases queries as a buyer would and respects the configured limit", () => {
    const q = webQueryTerms(criteria, 3);
    expect(q).toHaveLength(3); expect(q[0]).toBe('"looking for" NetSuite implementation partner'); expect(q[1]).toBe("NetSuite implementation RFP");
  });
});

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
async function workspace() { const w = await makeWorkspace("BuyerFixture"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id); return w; }
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });
beforeEach(() => { vi.mocked(complete).mockReset(); vi.mocked(providerJson).mockReset(); });

describe("resolving buyers during discovery", () => {
  const forum = page({ sourceUrl: "https://www.reddit.com/r/Netsuite/1", title: "RFP: NetSuite implementation", description: "Northwind Traders is inviting proposals for a NetSuite implementation partner by March." });
  const anonymous = page({ sourceUrl: "https://www.reddit.com/r/Netsuite/2", title: "RFP: NetSuite implementation", description: "My employer is inviting proposals for a NetSuite implementation partner." });
  it("keeps only buyers the text itself names, and counts every other outcome", async () => {
    vi.mocked(complete).mockResolvedValue(ok(JSON.stringify([{ i: 0, buyer: "Northwind Traders", quote: "inviting proposals for a NetSuite implementation partner" }, { i: 1, buyer: "Invented Corp", quote: "inviting proposals for a NetSuite implementation partner" }])));
    const { kept, screened } = await resolveBuyers(randomUUID(), [forum, anonymous, page({ title: "10 Best NetSuite Implementation Partners", description: "Compare partners." })], criteria);
    expect(kept.map(d => d.company.name)).toEqual(["Northwind Traders"]);
    expect(kept[0].rawSourceReference.buyerAttribution).toMatchObject({ method: "named_in_text", quote: "inviting proposals for a NetSuite implementation partner" });
    expect(screened).toMatchObject({ no_named_buyer: 1 }); expect(Object.values(screened).reduce((a, b) => a + b, 0)).toBe(2);
  });
  it("keeps nothing it could not check when the model is unavailable, and says so", async () => {
    vi.mocked(complete).mockResolvedValue({ ok: false, code: "not_configured", reason: "none", latencyMs: 0 });
    const { kept, screened } = await resolveBuyers(randomUUID(), [forum], criteria);
    expect(kept).toEqual([]); expect(screened).toEqual({ ai_unavailable: 1 });
  });
  it("qualifies a named buyer end to end without a review queue, and does not duplicate on redelivery", async () => {
    vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
    const w = await workspace();
    await connectOpportunityProvider(w.ctx, "brave", { apiKey: "fixture-key", config: { maxQueries: 1 }, allowedSearch: true, allowedStorage: true });
    vi.mocked(providerJson).mockResolvedValue({ web: { results: [
      { title: "Request for Proposal: NetSuite implementation", url: "https://www.fictional-buyer.invalid/rfp", description: "Fictional Buyer Ltd invites proposals from partners for a NetSuite implementation and integration.", profile: { name: "Fictional Buyer" } },
      { title: "10 Best NetSuite Implementation Partners for 2026", url: "https://blog.fixture.invalid/best", description: "Compare the top partners to implement NetSuite." },
    ] } });
    const s = await db.opportunitySearch.create({ data: { workspaceId: w.workspace.id, createdById: w.user.id, query: "NetSuite implementation", criteria, providers: ["brave"], idempotencyKey: randomUUID() } });
    expect(await discoverOpportunities(w.workspace.id, s.id)).toMatchObject({ state: "COMPLETED", found: 2, qualified: 1 });
    expect(complete).not.toHaveBeenCalled();
    expect(await db.discoveryCandidate.count({ where: { workspaceId: w.workspace.id } })).toBe(0);
    const company = await db.company.findFirstOrThrow({ where: { workspaceId: w.workspace.id } });
    expect(company).toMatchObject({ name: "Fictional Buyer", domain: "fictional-buyer.invalid" });
    const row = await db.opportunitySearch.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.providerResults).toMatchObject({ brave: { found: 2, screened: { seller_or_publisher: 1 } } });
    await db.opportunitySearch.update({ where: { id: s.id }, data: { state: "QUEUED", finishedAt: null } });
    await discoverOpportunities(w.workspace.id, s.id);
    expect(await db.opportunity.count({ where: { workspaceId: w.workspace.id } })).toBe(1);
  });
});
