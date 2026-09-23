import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mapLinkedInPost } from "@/lib/opportunities/linkedin-post";
import { parseOpportunityQuery } from "@/lib/opportunities/query-parser";

vi.mock("@/lib/providers/http", async (original) => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
vi.mock("@/lib/ai/complete", async (original) => ({ ...(await original<typeof import("@/lib/ai/complete")>()), complete: vi.fn() }));
import { providerJson, validateProviderUrl } from "@/lib/providers/http";
import { complete } from "@/lib/ai/complete";
import { discoveryProvider } from "@/lib/providers/discovery";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { discoverOpportunities } from "@/lib/services/opportunity-ingestion";
import { connectOpportunityProvider } from "@/lib/services/opportunity-providers";

const criteria = parseOpportunityQuery("NetSuite implementation");
const post = { post_url: "https://www.linkedin.com/posts/fictional-cfo_netsuite-activity-1", text: "We are looking for a NetSuite implementation partner to start in Q4. DM me.", posted_at: { date: "2026-09-20 10:00:00", timestamp: Date.UTC(2026, 8, 20, 10) }, author: { name: "Fictional CFO", headline: "CFO at Northwind Traders", profile_url: "https://www.linkedin.com/in/fictional-cfo" } };

describe("mapping a scraped post", () => {
  it("reads the common shape, keeps the author and puts the headline in the text", () => {
    const d = mapLinkedInPost(post, "linkedin_posts", "q")!;
    expect(d).toMatchObject({ kind: "LINKEDIN_PUBLIC_POST", company: { name: "" }, sourceUrl: "https://www.linkedin.com/posts/fictional-cfo_netsuite-activity-1", postedAt: "2026-09-20T10:00:00.000Z", rawSourceReference: { authorName: "Fictional CFO", authorHeadline: "CFO at Northwind Traders" } });
    expect(d.description).toContain("Posted by Fictional CFO, CFO at Northwind Traders");
  });
  it("accepts other common spellings", () => {
    expect(mapLinkedInPost({ postUrl: "https://linkedin.com/feed/update/urn:li:activity:1", content: "Need a NetSuite partner", authorName: "Jo", postedAt: "2026-09-21T00:00:00Z" }, "p", "q")).toMatchObject({ rawSourceReference: { authorName: "Jo" }, postedAt: "2026-09-21T00:00:00.000Z" });
  });
  it("reads a date with no timezone as UTC, not server-local time", () => {
    expect(mapLinkedInPost({ ...post, posted_at: "2026-09-20 10:00:00" }, "p", "q")?.postedAt).toBe("2026-09-20T10:00:00.000Z");
  });
  it("refuses anything that is not a readable LinkedIn post", () => {
    expect(mapLinkedInPost({ ...post, post_url: "https://evil.invalid/x" }, "p", "q")).toBeNull();
    expect(mapLinkedInPost({ ...post, text: "" }, "p", "q")).toBeNull();
    expect(mapLinkedInPost("nope", "p", "q")).toBeNull();
  });
});

describe("the Apify adapter", () => {
  beforeEach(() => vi.mocked(providerJson).mockReset());
  const adapter = () => discoveryProvider("workspace", "linkedin_posts", { maxQueries: 2, postsPerQuery: 10 }, "apify-test-token");
  it("runs the actor with the token as a header and buyer-phrased keywords", async () => {
    vi.mocked(providerJson).mockResolvedValue([post]);
    const rows = await adapter().search(criteria);
    expect(rows).toHaveLength(1);
    const [, provider, url, headers, body] = vi.mocked(providerJson).mock.calls[0];
    expect(provider).toBe("linkedin_posts"); expect(url).toMatch(/^https:\/\/api\.apify\.com\/v2\/acts\/.+\/run-sync-get-dataset-items/); expect(url).not.toContain("token=");
    expect(headers).toEqual({ Authorization: "Bearer apify-test-token" });
    expect(body).toMatchObject({ keyword: '"looking for" NetSuite implementation partner', sort_type: "date_posted", date_filter: "past-month", limit: 10 });
    expect(() => validateProviderUrl(url as string)).not.toThrow();
  });
  it("fails loudly when posts arrive in a format it cannot read, instead of reporting none", async () => {
    vi.mocked(providerJson).mockResolvedValue([{ unexpected: true }, { also: "unknown" }]);
    await expect(adapter().search(criteria)).rejects.toThrow("cannot read");
  });
  it("keeps posts already retrieved when a later query fails", async () => {
    vi.mocked(providerJson).mockResolvedValueOnce([post]).mockRejectedValueOnce(new Error("quota"));
    await expect(adapter().search(criteria)).rejects.toMatchObject({ documents: [expect.objectContaining({ sourceUrl: post.post_url })] });
  });
  it("tests the token without paying for a scrape", async () => {
    vi.mocked(providerJson).mockResolvedValue({ data: { id: "u" } });
    expect(await adapter().healthCheck()).toMatchObject({ ok: true });
    expect(vi.mocked(providerJson).mock.calls[0][2]).toBe("https://api.apify.com/v2/users/me");
  });
});

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });

describe("a LinkedIn post end to end", () => {
  it("qualifies the organisation named in the author's headline, with the poster recorded", async () => {
    vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
    const w = await makeWorkspace("LinkedInPostFixture"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    await connectOpportunityProvider(w.ctx, "linkedin_posts", { apiKey: "apify-test-token", config: { maxQueries: 1, postsPerQuery: 10 }, allowedSearch: true, allowedStorage: true });
    vi.mocked(providerJson).mockResolvedValue([post, { ...post, post_url: "https://www.linkedin.com/posts/consultant_2", text: "We help companies implement NetSuite. Book a call.", author: { name: "A Consultant", headline: "NetSuite consultant" } }]);
    vi.mocked(complete).mockResolvedValue({ ok: true, text: JSON.stringify([{ i: 0, buyer: "Northwind Traders", quote: "We are looking for a NetSuite implementation partner" }]), model: "claude-haiku-4-5-20251001", provider: "anthropic", inputTokens: 1, outputTokens: 1, latencyMs: 1, estimatedCostInr: 0 });
    const s = await db.opportunitySearch.create({ data: { workspaceId: w.workspace.id, createdById: w.user.id, query: "NetSuite implementation", criteria, providers: ["linkedin_posts"], idempotencyKey: randomUUID() } });
    expect(await discoverOpportunities(w.workspace.id, s.id)).toMatchObject({ state: "COMPLETED", found: 2, qualified: 1 });
    const source = await db.opportunitySource.findFirstOrThrow({ where: { workspaceId: w.workspace.id }, include: { opportunity: { include: { company: true } } } });
    expect(source.opportunity.company.name).toBe("Northwind Traders");
    expect(source.rawReference).toMatchObject({ authorName: "Fictional CFO", buyerAttribution: { method: "named_in_text" } });
    expect((await db.opportunitySearch.findUniqueOrThrow({ where: { id: s.id } })).providerResults).toMatchObject({ linkedin_posts: { screened: { seller_or_publisher: 1 } } });
  });
});
