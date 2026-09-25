import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/providers/http", async (original) => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
vi.mock("@/lib/ai/complete", async (original) => ({ ...(await original<typeof import("@/lib/ai/complete")>()), complete: vi.fn() }));
import { providerJson } from "@/lib/providers/http";
import { complete } from "@/lib/ai/complete";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { fakeActors } from "./helpers/enrichment-fixture";
import { connectOpportunityProvider } from "@/lib/services/opportunity-providers";
import { discoverOpportunities } from "@/lib/services/opportunity-ingestion";
import { createSearchPhrase } from "@/lib/services/search-phrases";
import { phraseWatchability, runDuePhraseWatches } from "@/lib/services/phrase-watches";
import { getOpportunityWatch, saveOpportunitySearch, updateOpportunityWatch } from "@/lib/services/opportunities";
import { opportunityToCrm } from "@/lib/services/opportunity-actions";
import { providersForPhrase } from "@/lib/opportunities/phrase-sources";

const JOB = (id: string) => ({ key: id, url: `https://in.indeed.com/viewjob?jk=${id}`, jobUrl: `https://in.indeed.com/viewjob?jk=${id}`, title: "NetSuite Implementation Consultant", datePublished: new Date(Date.now() - 86400000).toISOString(), location: { city: "Pune", countryCode: "IN" }, employer: { name: `Northwind ${id}`, corporateWebsite: `https://northwind-${id}.example` }, description: { text: "We are hiring a NetSuite consultant to lead our NetSuite implementation in Pune, India." } });

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });
beforeEach(() => { vi.mocked(providerJson).mockReset(); vi.mocked(complete).mockReset().mockResolvedValue({ ok: false, code: "not_configured", reason: "none" } as never); });
async function workspace() {
  vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
  const w = await makeWorkspace("PhraseWatch"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  await connectOpportunityProvider(w.ctx, "linkedin_posts", { apiKey: "apify-test-token", config: {}, allowedSearch: true, allowedStorage: true });
  return w;
}

describe("phrase watching", () => {
  it("maps a phrase's source kind to connected sources, and says why one cannot run", async () => {
    expect(providersForPhrase("JOB_BOARD", ["apify_indeed", "brave"])).toEqual(["apify_indeed"]);
    expect(providersForPhrase("USER_MANUAL", ["brave"])).toEqual([]);
    const w = await workspace();
    const p = await createSearchPhrase(w.ctx, { phrase: "NetSuite implementation", sourceKind: "JOB_BOARD" });
    expect((await phraseWatchability(w.ctx))[p.id]).toMatchObject({ providers: [], reason: expect.stringContaining("apify_indeed") });
  });

  it("runs a due phrase once per cadence as a tracked search, alerts once for new matches, and attributes the lead", async () => {
    const w = await workspace();
    await connectOpportunityProvider(w.ctx, "apify_indeed", { config: { maxQueries: 1 }, allowedSearch: true, allowedStorage: true });
    const fake = fakeActors({ "valig/indeed-jobs-scraper": () => [JOB("a")] });
    vi.mocked(providerJson).mockImplementation(fake.handler as never);
    const p = await createSearchPhrase(w.ctx, { phrase: "NetSuite implementation in India", sourceKind: "JOB_BOARD", cadenceHours: 24 });
    const later = new Date(Date.now() + 120_000);
    expect(await runDuePhraseWatches(w.workspace.id, later)).toMatchObject({ started: 1 });
    // The hourly job firing again inside the same cadence starts nothing.
    expect(await runDuePhraseWatches(w.workspace.id, later)).toMatchObject({ started: 0 });
    const search = await db.opportunitySearch.findFirstOrThrow({ where: { workspaceId: w.workspace.id, searchPhraseId: p.id } });
    expect(search.providers).toEqual(["apify_indeed"]);
    await discoverOpportunities(w.workspace.id, search.id);
    const run = await db.searchRun.findFirstOrThrow({ where: { searchPhraseId: p.id } });
    expect(run).toMatchObject({ state: "SUCCEEDED", signalsFound: 1, duplicates: 0 });
    expect(await db.notification.count({ where: { workspaceId: w.workspace.id, title: { contains: "New matches for" } } })).toBe(1);
    // Next cadence: the same posting again is not new, so no second alert.
    const nextDay = new Date(Date.now() + 25 * 3600000);
    await runDuePhraseWatches(w.workspace.id, nextDay);
    const second = await db.opportunitySearch.findFirstOrThrow({ where: { workspaceId: w.workspace.id, searchPhraseId: p.id, id: { not: search.id } } });
    await discoverOpportunities(w.workspace.id, second.id);
    expect(await db.notification.count({ where: { workspaceId: w.workspace.id, title: { contains: "New matches for" } } })).toBe(1);
    expect(await db.searchRun.findFirstOrThrow({ where: { idempotencyKey: second.idempotencyKey } })).toMatchObject({ duplicates: 1 });
    // A lead made from the opportunity carries the phrase for revenue attribution.
    const opp = await db.opportunity.findFirstOrThrow({ where: { workspaceId: w.workspace.id } });
    const person = await db.person.create({ data: { workspaceId: w.workspace.id, fullName: "Asha Synthetic", country: "Unknown" } });
    await db.employment.create({ data: { workspaceId: w.workspace.id, personId: person.id, companyId: opp.companyId, title: "IT Head", isCurrent: true, association: "current" } });
    const { leadId } = await opportunityToCrm(w.ctx, opp.id, { personId: person.id });
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).sourcePhraseId).toBe(p.id);
  });
});

describe("opportunity watches", () => {
  it("restores a saved watch for editing, updates it in place, and hides other workspaces' watches", async () => {
    const w = await workspace(); const other = await workspace();
    const saved = await saveOpportunitySearch(w.ctx, { name: "NetSuite watch", query: "NetSuite implementation", providers: ["brave"], cadenceHours: 24 });
    expect(await getOpportunityWatch(w.ctx, saved.id)).toMatchObject({ query: "NetSuite implementation", providers: ["brave"], cadenceHours: 24 });
    expect(await getOpportunityWatch(other.ctx, saved.id)).toBeNull();
    await expect(updateOpportunityWatch(other.ctx, saved.id, { name: "x y", query: "hijack query", providers: ["brave"] })).rejects.toThrow();
    await updateOpportunityWatch(w.ctx, saved.id, { name: "NetSuite watch", query: "NetSuite integration", providers: ["brave"], cadenceHours: 72 });
    expect(await getOpportunityWatch(w.ctx, saved.id)).toMatchObject({ query: "NetSuite integration", cadenceHours: 72 });
    expect(await db.savedSearch.count({ where: { workspaceId: w.workspace.id } })).toBe(1);
  });
});
