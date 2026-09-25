import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/providers/http", async (original) => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
vi.mock("@/lib/ai/complete", async (original) => ({ ...(await original<typeof import("@/lib/ai/complete")>()), complete: vi.fn() }));
import { providerJson } from "@/lib/providers/http";
import { ProviderRequestError } from "@/lib/providers/provider-errors";
import { complete } from "@/lib/ai/complete";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { connectOpportunityProvider, testOpportunityProvider } from "@/lib/services/opportunity-providers";
import { cancelEnrichment, decideEmailDomain, getEnrichmentRun, getOpportunityEnrichment, retryEnrichment, selectEnrichmentCompany, startEnrichment } from "@/lib/services/enrichment";
import { runEnrichment } from "@/lib/services/enrichment-runner";
import { getOpportunityReadiness } from "@/lib/services/opportunity-readiness";
import { opportunityToCrm } from "@/lib/services/opportunity-actions";
import { getCapabilities } from "@/lib/services/capabilities";
import { isQueueConfigured } from "@/lib/queue/connection";
import { freshStages, type RunKind, type Stage } from "@/lib/enrichment/stages";
import { ATZEAN, COMPANY_PAGE, COMPANY_URL, EMPLOYEES, POST_REFERENCE, POST_TEXT, SEARCH_ITEMS, VERIFY_ITEMS, WEBSITE_ITEMS, fakeActors, quotaError } from "./helpers/enrichment-fixture";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.mocked(providerJson).mockReset();
  vi.mocked(complete).mockReset().mockResolvedValue({ ok: false, code: "not_configured", reason: "No model provider is connected" } as never);
});

const DEFAULTS = {
  "apify/google-search-scraper": () => SEARCH_ITEMS,
  "harvestapi/linkedin-company": () => [COMPANY_PAGE],
  "harvestapi/linkedin-company-employees": () => EMPLOYEES,
  "automation-lab/website-contact-finder": () => WEBSITE_ITEMS,
  "bounceverify/bounceverify-email-verifier": (i: Record<string, unknown>) => (i.emails as string[]).map(e => VERIFY_ITEMS.find(v => v.email === e) ?? { email: e }),
};
function apify(over: Partial<Record<keyof typeof DEFAULTS, (i: Record<string, unknown>) => unknown[] | Error>> = {}, opts: Parameters<typeof fakeActors>[1] = {}) {
  const fake = fakeActors({ ...DEFAULTS, ...over } as never, opts);
  vi.mocked(providerJson).mockImplementation(fake.handler as never);
  return fake;
}

/** The screenshot's case: a buyer named in a LinkedIn post, domain unknown, nobody saved. Synthetic throughout. */
async function atzean(opts: { enrichment?: boolean; permissions?: string } = {}) {
  vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
  const w = await makeWorkspace("EnrichmentFixture"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  await connectOpportunityProvider(w.ctx, "linkedin_posts", { apiKey: "apify-test-token", config: {}, allowedSearch: true, allowedStorage: true });
  if (opts.enrichment !== false) await connectOpportunityProvider(w.ctx, "apify_enrichment", { config: {}, allowedSearch: true, allowedStorage: true, allowedEnrichment: true });
  const company = await db.company.create({ data: { workspaceId: w.workspace.id, name: ATZEAN.name, country: "Unknown" } });
  const opportunity = await db.opportunity.create({ data: { workspaceId: w.workspace.id, companyId: company.id, title: "Looking for IT staffing partners for contract Java developers", service: "IT staffing", types: ["EXTERNAL_VENDOR", "STAFF_AUGMENTATION"], location: "Pune, India", dedupeKey: randomUUID(), status: "UNKNOWN" } });
  await db.opportunitySource.create({ data: { workspaceId: w.workspace.id, opportunityId: opportunity.id, provider: "linkedin_posts", kind: "LINKEDIN_PUBLIC_POST", externalId: `https://www.linkedin.com/posts/riya-synthetic_${randomUUID()}`, sourceUrl: `https://www.linkedin.com/posts/riya-synthetic_${randomUUID()}`, title: POST_TEXT.slice(0, 120), description: POST_TEXT, contentHash: "h", rawReference: POST_REFERENCE, expiresAt: new Date(Date.now() + 86400000) } });
  return { ...w, company, opportunity };
}
/** Starts a run the way the button does, then runs the worker's handler for it. */
async function press(w: Awaited<ReturnType<typeof atzean>>, kind: RunKind, refresh = false) {
  let runId: string;
  if (isQueueConfigured()) runId = (await startEnrichment(w.ctx, w.opportunity.id, { kind, refresh })).run.id;
  else runId = (await db.enrichmentRun.create({ data: { workspaceId: w.workspace.id, opportunityId: w.opportunity.id, companyId: w.company.id, requestedById: w.user.id, kind, refresh, stages: freshStages(kind) as never, budgetUsd: 1 } })).id;
  await runEnrichment(w.workspace.id, runId);
  return getEnrichmentRun(w.ctx, runId);
}
const stage = (run: { stages: unknown }, key: string) => (run.stages as Stage[]).find(s => s.key === key)!;

describe("Research company", () => {
  it("resolves a company whose domain was unknown and saves its fields with provenance, without touching the opportunity's status", async () => {
    const w = await atzean(); apify();
    const run = await press(w, "research");
    expect(run.state).toBe("COMPLETED");
    expect(stage(run, "resolve")).toMatchObject({ status: "done", counts: { confidence: 70 } });
    expect(stage(run, "details")).toMatchObject({ status: "done", counts: { fieldsUpdated: expect.any(Number) } });
    expect(stage(run, "summary")).toMatchObject({ status: "skipped", reason: expect.stringContaining("company data above is saved") });
    const c = await db.company.findUniqueOrThrow({ where: { id: w.company.id } });
    expect(c).toMatchObject({ domain: "atzean-synthetic.example", website: "https://www.atzean-synthetic.example", linkedinUrl: COMPANY_URL, industry: "IT Services and IT Consulting", city: "Pune", country: "India", employeeCount: 45 });
    expect((c.enrichment as { fields: Record<string, { source: string; confidence: number; retrievedAt: string }> }).fields.domain).toMatchObject({ source: "apify:harvestapi/linkedin-company", confidence: 70, retrievedAt: expect.any(String) });
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: w.opportunity.id } })).status).toBe("UNKNOWN");
  });

  it("recomputes fit once research fills in the company, and explains it", async () => {
    const w = await atzean(); apify();
    await db.icpProfile.create({ data: { workspaceId: w.workspace.id, name: "IT services", isPrimary: true, industries: ["IT Services"], locations: ["Pune"], employeeMin: 10, employeeMax: 200, buyerRoles: [], seniorities: [], technologies: [], pains: [], triggerEvents: [], exclusions: [] } });
    const before = await getOpportunityReadiness(w.ctx, w.opportunity.id);
    expect(before.fit.state).toBe("unassessed");
    expect(before.stages.find(s => s.key === "researched")?.done).toBe(false);
    await press(w, "research");
    const o = await db.opportunity.findUniqueOrThrow({ where: { id: w.opportunity.id } });
    expect(o.fitScore).toBe(80);
    const after = await getOpportunityReadiness(w.ctx, w.opportunity.id);
    expect(after.fit.state).toBe("assessed");
    expect(after.stages.find(s => s.key === "researched")?.done).toBe(true);
    expect(after.stages.find(s => s.key === "contact_ready")?.done).toBe(false);
  });

  it("asks a person to choose between plausible companies, blocks only the steps that need it, and never lets automation overwrite the choice", async () => {
    const w = await atzean();
    const twin = { ...COMPANY_PAGE, linkedinUrl: "https://www.linkedin.com/company/atzean-tech-pune-synthetic", website: null };
    apify({ "apify/google-search-scraper": () => [{ organicResults: [{ title: "Atzean | LinkedIn", url: COMPANY_URL, description: "" }, { title: "Atzean | LinkedIn", url: twin.linkedinUrl, description: "" }] }], "harvestapi/linkedin-company": () => [{ ...COMPANY_PAGE, website: null }, twin] });
    const run = await press(w, "people");
    expect(run.state).toBe("NEEDS_SELECTION");
    expect(stage(run, "people")).toMatchObject({ status: "blocked" });
    expect((run.result as { candidates: unknown[] }).candidates).toHaveLength(2);
    expect(await db.employment.count({ where: { companyId: w.company.id } })).toBe(0);
    const fake = apify();
    if (isQueueConfigured()) await selectEnrichmentCompany(w.ctx, run.id, { index: 0 });
    else throw new Error("This test needs the test Redis (TEST_REDIS_URL or REDIS_URL db 15).");
    await runEnrichment(w.workspace.id, run.id);
    const after = await getEnrichmentRun(w.ctx, run.id);
    expect(after.state).toBe("COMPLETED");
    expect(fake.startsOf("harvestapi/linkedin-company-employees")).toBe(1);
    const c = await db.company.findUniqueOrThrow({ where: { id: w.company.id } });
    expect((c.enrichment as { fields: { linkedinUrl: { confirmedBy: string } } }).fields.linkedinUrl.confirmedBy).toBe(w.user.id);
    // A later refresh that finds a different page cannot replace what a person confirmed.
    apify({ "harvestapi/linkedin-company": () => [{ ...COMPANY_PAGE, linkedinUrl: "https://www.linkedin.com/company/other-synthetic" }] });
    await press(w, "research", true);
    expect((await db.company.findUniqueOrThrow({ where: { id: w.company.id } })).linkedinUrl).toBe(COMPANY_URL);
  });
});

describe("Find people", () => {
  it("saves relevant people with or without emails, tells current from former, and dedupes the post author", async () => {
    const w = await atzean(); const fake = apify();
    const run = await press(w, "people");
    expect(run.state).toBe("COMPLETED");
    expect(stage(run, "people")).toMatchObject({ status: "done", counts: { saved: 4, updated: 1, former: 1, uncertain: 1, withoutTitle: 2 } }); // Arjun, and the uncertain person who holds no position here
    // The author (Riya) was saved first from the post, then matched by profile id, not duplicated.
    expect(await db.person.count({ where: { workspaceId: w.workspace.id, fullName: "Riya Synthetic" } })).toBe(1);
    const { people } = await getOpportunityEnrichment(w.ctx, w.opportunity.id);
    expect(people.map(p => [p.name, p.association]).sort()).toEqual([["Arjun", "current"], ["Riya Synthetic", "current"], ["Unrelated Person", "uncertain"]]);
    expect(people.every(p => p.contacts.length === 0)).toBe(true);
    const input = fake.starts.find(s => s.actor === "harvestapi/linkedin-company-employees")!.input;
    expect(input).toMatchObject({ companies: [COMPANY_URL], profileScraperMode: "Full ($8 per 1k)", searchQuery: expect.stringContaining('"Talent Acquisition"') });
  });

  it("does not repeat a fresh search, and a forced re-run creates no duplicates", async () => {
    const w = await atzean(); const fake = apify();
    await press(w, "people");
    const again = await press(w, "people");
    expect(stage(again, "people")).toMatchObject({ status: "skipped" });
    expect(fake.startsOf("harvestapi/linkedin-company-employees")).toBe(1);
    await press(w, "people", true);
    expect(fake.startsOf("harvestapi/linkedin-company-employees")).toBe(2);
    expect(await db.person.count({ where: { workspaceId: w.workspace.id } })).toBe(4);
    expect(await db.employment.count({ where: { workspaceId: w.workspace.id } })).toBe(4);
  });

  it("reports zero results as no matches with the reason", async () => {
    const w = await atzean(); apify({ "harvestapi/linkedin-company-employees": () => [] });
    const run = await press(w, "people");
    expect(stage(run, "people")).toMatchObject({ status: "done" }); // the post's author was still found
    const w2 = await atzean(); apify({ "harvestapi/linkedin-company-employees": () => [] });
    await db.opportunitySource.updateMany({ where: { opportunityId: w2.opportunity.id }, data: { rawReference: {} } });
    const empty = await press(w2, "people");
    expect(empty.state).toBe("NO_MATCHES");
    expect(stage(empty, "people").reason).toMatch(/returned nobody/);
  });
});

describe("Find emails and Check emails", () => {
  it("keeps company-wide and personal addresses apart, never gives a role address to a person, and invents nothing", async () => {
    const w = await atzean(); apify();
    await press(w, "people");
    const run = await press(w, "emails");
    // Nothing is discarded for its domain any more: the other-domain address is kept for review.
    expect(stage(run, "emails")).toMatchObject({ status: "done", counts: { inferred: 1, generic: 3, unassigned: 1, review: 1 } });
    const snap = await getOpportunityEnrichment(w.ctx, w.opportunity.id);
    expect(snap.contactPoints.map(p => [p.value, p.isGeneric]).sort()).toEqual([["careers@atzean-synthetic.example", true], ["info@atzean-synthetic.example", true], ["karan.mehta@atzean-synthetic.example", false], ["partners@atzean-synthetic.example", true], ["sales.lead@othercorp.example", false]]);
    expect(await db.companyContactPoint.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "sales.lead@othercorp.example" } })).toMatchObject({ domainStatus: "review" });
    const riya = snap.people.find(p => p.name === "Riya Synthetic")!;
    expect(riya.contacts.map(c => c.value)).toEqual(["riya.synthetic@atzean-synthetic.example"]);
    // Given to her because it contains her name — recorded as an inference, not as her confirmed address.
    expect(riya.contacts[0]).toMatchObject({ verificationResult: "UNCHECKED", provenance: { discovery: { kind: "website", url: "https://atzean-synthetic.example/contact" }, ownership: { basis: "inferred_from_name" } } });
    expect(snap.people.filter(p => p.name !== "Riya Synthetic").every(p => p.contacts.length === 0)).toBe(true);
    expect(await db.contactMethod.count({ where: { workspaceId: w.workspace.id, value: { startsWith: "info@" } } })).toBe(0);
  });

  it("lets a person accept or reject a domain under review, records it, and keeps other workspaces out", async () => {
    const w = await atzean(); apify();
    await press(w, "people"); await press(w, "emails");
    const other = await atzean();
    await expect(decideEmailDomain(other.ctx, w.opportunity.id, { domain: "othercorp.example", decision: "accept" })).rejects.toThrow();
    await expect(decideEmailDomain(w.ctx, w.opportunity.id, { domain: "never-seen.example", decision: "accept" })).rejects.toThrow(/has not been seen/);
    const r = await decideEmailDomain(w.ctx, w.opportunity.id, { domain: "othercorp.example", decision: "reject" });
    expect(r).toMatchObject({ status: "rejected", addresses: 1 });
    expect(await db.companyContactPoint.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "sales.lead@othercorp.example" } })).toMatchObject({ domainStatus: "rejected" });
    const domains = ((await db.company.findUniqueOrThrow({ where: { id: w.company.id } })).enrichment as { emailDomains: { domain: string; status: string; decidedBy?: string }[] }).emailDomains;
    expect(domains.find(d => d.domain === "othercorp.example")).toMatchObject({ status: "rejected", decidedBy: w.user.id });
    // A later run keeps the decision instead of re-opening it.
    await press(w, "emails", true);
    expect(await db.companyContactPoint.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "sales.lead@othercorp.example" } })).toMatchObject({ domainStatus: "rejected" });
    expect(await db.auditLog.count({ where: { workspaceId: w.workspace.id, action: "company.email_domain_decided" } })).toBe(1);
  });

  it("refuses to check when nothing has been found, and says to find emails first", async () => {
    const w = await atzean(); apify();
    if (!isQueueConfigured()) return;
    await expect(startEnrichment(w.ctx, w.opportunity.id, { kind: "verify" })).rejects.toMatchObject({ code: "no_addresses", message: expect.stringContaining("Find emails first") });
    expect(await db.enrichmentRun.count({ where: { workspaceId: w.workspace.id } })).toBe(0);
  });

  it("records each check's method and original result, keeps inconclusive and catch-all apart from confirmed, and does not pay twice", async () => {
    const w = await atzean(); const fake = apify();
    await press(w, "people"); await press(w, "emails");
    const run = await press(w, "verify");
    expect(stage(run, "verify")).toMatchObject({ status: "done", counts: { checked: 5, MAILBOX_CONFIRMED: 1, CATCH_ALL: 1, INCONCLUSIVE: 1, INVALID: 1, DOMAIN_VALID: 1 } });
    const riya = await db.contactMethod.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "riya.synthetic@atzean-synthetic.example" } });
    expect(riya).toMatchObject({ verificationResult: "MAILBOX_CONFIRMED", status: "VERIFIED", provenance: { verification: { method: "apify", actor: "bounceverify/bounceverify-email-verifier", raw: { reason: "SMTP mailbox exists" } } } });
    const careers = await db.companyContactPoint.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "careers@atzean-synthetic.example" } });
    expect(careers.verificationResult).toBe("INCONCLUSIVE");
    expect(await db.contactMethod.count({ where: { workspaceId: w.workspace.id, status: "VERIFIED" } })).toBe(1);
    const again = await press(w, "verify");
    expect(stage(again, "verify")).toMatchObject({ status: "skipped", counts: { cached: 5 } });
    expect(fake.startsOf("bounceverify/bounceverify-email-verifier")).toBe(1);
  });
});

describe("Enrich opportunity", () => {
  it("runs every stage, and a quota failure on the last one keeps what earlier stages saved and retries only that one", async () => {
    const w = await atzean(); let refuse = true;
    const fake = apify({ "bounceverify/bounceverify-email-verifier": i => (refuse ? quotaError() : DEFAULTS["bounceverify/bounceverify-email-verifier"](i)) });
    const run = await press(w, "enrich");
    expect(run.state).toBe("PARTIAL");
    expect(stage(run, "verify")).toMatchObject({ status: "failed", reason: expect.stringContaining("no remaining credit") });
    expect(stage(run, "people").status).toBe("done");
    expect(await db.employment.count({ where: { companyId: w.company.id } })).toBe(4);
    refuse = false;
    if (!isQueueConfigured()) return;
    await retryEnrichment(w.ctx, run.id);
    await runEnrichment(w.workspace.id, run.id);
    const after = await getEnrichmentRun(w.ctx, run.id);
    expect(after.state).toBe("COMPLETED");
    for (const actor of ["harvestapi/linkedin-company-employees", "automation-lab/website-contact-finder", "apify/google-search-scraper"]) expect(fake.startsOf(actor)).toBe(1);
    expect(fake.startsOf("bounceverify/bounceverify-email-verifier")).toBe(1);
  });

  it("reads a run whose start reply was lost instead of starting and paying for it again", async () => {
    const w = await atzean();
    const fake = apify({}, { loseReply: (actor, attempt) => actor === "harvestapi/linkedin-company-employees" && attempt === 1 });
    const run = await press(w, "people");
    expect(stage(run, "people").status).toBe("failed"); // the first attempt could not know its run id
    if (!isQueueConfigured()) return;
    await retryEnrichment(w.ctx, run.id);
    await runEnrichment(w.workspace.id, run.id);
    expect((await getEnrichmentRun(w.ctx, run.id)).state).toBe("COMPLETED");
    expect(fake.startsOf("harvestapi/linkedin-company-employees")).toBe(1);
  });

  it("skips a step that would exceed the run's budget, and says so", async () => {
    const w = await atzean(); apify();
    await db.providerConnection.update({ where: { workspaceId_provider: { workspaceId: w.workspace.id, provider: "apify_enrichment" } }, data: { config: { maxUsdPerRun: 0.05 } } });
    const run = await press(w, "people");
    expect(stage(run, "people")).toMatchObject({ status: "skipped", reason: expect.stringContaining("budget") });
  });

  it("stops between steps when cancelled, keeping what was saved", async () => {
    const w = await atzean(); apify();
    if (!isQueueConfigured()) return;
    const { run } = await startEnrichment(w.ctx, w.opportunity.id, { kind: "enrich" });
    expect((await cancelEnrichment(w.ctx, run.id)).state).toBe("CANCELLED");
    await runEnrichment(w.workspace.id, run.id);
    expect((await getEnrichmentRun(w.ctx, run.id)).state).toBe("CANCELLED");
    expect(vi.mocked(providerJson)).not.toHaveBeenCalled();
  });

  it("returns the active run on a second press instead of starting another", async () => {
    const w = await atzean(); apify();
    if (!isQueueConfigured()) return;
    const first = await startEnrichment(w.ctx, w.opportunity.id, { kind: "enrich" });
    const second = await startEnrichment(w.ctx, w.opportunity.id, { kind: "people" });
    expect(second).toMatchObject({ reused: true, run: { id: first.run.id } });
    // Whether a worker is connected is reported by BullMQ from Redis's server-wide client list, so any
    // worker on this machine counts; the "no worker" notice itself is covered in search-status.test.ts.
    expect(await db.enrichmentRun.count({ where: { workspaceId: w.workspace.id } })).toBe(1);
  });
});

describe("Contact-provider fallback", () => {
  type Calls = { provider: string; url: string; body?: Record<string, unknown> }[];
  /** Apify fakes plus canned SignalHire / Hunter / Apollo answers, recording every provider call. */
  function withProviders(answers: Partial<Record<"signalhire" | "hunter" | "apollo", (url: string, body?: Record<string, unknown>) => unknown>>) {
    const fake = apify(); const calls: Calls = [];
    vi.mocked(providerJson).mockImplementation((async (ws: string, provider: string, url: string, headers?: Record<string, string>, body?: Record<string, unknown>) => {
      if (provider in answers) { calls.push({ provider, url, body }); const out = answers[provider as keyof typeof answers]!(url, body); if (out instanceof Error) throw out; return out; }
      return fake.handler(ws, provider, url, headers, body);
    }) as never);
    return calls;
  }
  async function enable(w: Awaited<ReturnType<typeof atzean>>, fallback: Record<string, unknown>, providers: ("signalhire" | "hunter" | "apollo")[]) {
    await connectOpportunityProvider(w.ctx, "apify_enrichment", { config: { fallback: { enabled: true, ...fallback } }, allowedSearch: true, allowedStorage: true, allowedEnrichment: true });
    for (const p of providers) await connectOpportunityProvider(w.ctx, p, { apiKey: `${p}-test-key`, config: {}, allowedSearch: true, allowedStorage: true, allowedEnrichment: true });
  }
  const shHit = (email: string, subType = "work") => [{ item: "x", status: "success", candidate: { uid: "a".repeat(32), fullName: "Arjun", contacts: [{ type: "email", value: email, subType, rating: 100 }] } }];

  it("is off by default and calls no provider", async () => {
    const w = await atzean(); const calls = withProviders({ signalhire: () => shHit("arjun@atzean-synthetic.example") });
    await connectOpportunityProvider(w.ctx, "signalhire", { apiKey: "k", config: {}, allowedSearch: true, allowedStorage: true, allowedEnrichment: true });
    await press(w, "people");
    const run = await press(w, "emails");
    expect(stage(run, "contacts")).toMatchObject({ status: "skipped", reason: expect.stringContaining("Contact providers are off") });
    expect(calls).toHaveLength(0);
  });

  it("tries providers in order, stops at the first hit, says which were not usable, and never pays twice", async () => {
    const w = await atzean();
    const calls = withProviders({ signalhire: (_u, b) => ((b?.items as string[])[0].includes("arjun") ? shHit("arjun@atzean-synthetic.example") : [{ item: "x", status: "failed" }]), hunter: () => ({ data: { email: null } }) });
    await enable(w, { order: ["signalhire", "hunter", "apollo"], maxLookupsPerRun: 10 }, ["signalhire", "hunter"]);
    await press(w, "people");
    const run = await press(w, "emails");
    const s = stage(run, "contacts");
    expect(s.status).toBe("done");
    expect(s.counts).toMatchObject({ found: 1, signalhire_found: 1 });
    expect(s.reason).toContain("Apollo is not connected");
    // SignalHire used its synchronous mode with the LinkedIn URL, never a callback.
    expect(calls.find(c => c.provider === "signalhire")?.body).toMatchObject({ withoutWaterfall: true });
    expect(calls.some(c => c.provider === "signalhire" && JSON.stringify(c.body).includes("callbackUrl"))).toBe(false);
    // Arjun was found at SignalHire, so Hunter was never asked about him.
    expect(calls.filter(c => c.provider === "hunter" && c.url.includes("first_name=Arjun"))).toHaveLength(0);
    const arjun = await db.contactMethod.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "arjun@atzean-synthetic.example" } });
    expect(arjun).toMatchObject({ source: "signalhire:provider", verificationResult: "UNCHECKED", provenance: expect.objectContaining({ ownership: expect.objectContaining({ basis: "provider_associated" }) }) });
    const before = calls.length;
    const again = await press(w, "emails");
    expect(calls.length).toBe(before);
    expect(stage(again, "contacts").counts).toMatchObject({ lookups: 0, alreadyTried: expect.any(Number) });
  });

  it("keeps a role address a provider returns on the company, and a refused provider does not stop the next one", async () => {
    const w = await atzean();
    withProviders({ signalhire: () => { throw new ProviderRequestError("402", "http", 402); }, apollo: () => ({ person: { id: "ap1", email: "hr@atzean-synthetic.example", email_status: "verified" }, match_confidence: "high" }) });
    await enable(w, { order: ["signalhire", "apollo"], maxLookupsPerRun: 2 }, ["signalhire", "apollo"]);
    await press(w, "people");
    const run = await press(w, "emails");
    const s = stage(run, "contacts");
    expect(s.counts).toMatchObject({ signalhire_failed: expect.any(Number), apollo_tried: expect.any(Number), found: 0 });
    expect(s.counts.lookups).toBeLessThanOrEqual(2);
    expect(s.reason).toContain("quota or credits");
    expect(await db.contactMethod.count({ where: { workspaceId: w.workspace.id, value: "hr@atzean-synthetic.example" } })).toBe(0);
    expect(await db.companyContactPoint.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "hr@atzean-synthetic.example" } })).toMatchObject({ isGeneric: true });
  });
});

describe("CRM and setup", () => {
  it("adds a found person without an email to CRM, idempotently, keeping their LinkedIn context", async () => {
    const w = await atzean(); apify();
    await press(w, "people");
    const arjun = (await getOpportunityEnrichment(w.ctx, w.opportunity.id)).people.find(p => p.name === "Arjun")!;
    const lead = await opportunityToCrm(w.ctx, w.opportunity.id, { personId: arjun.personId });
    expect(lead.created).toBe(true);
    expect((await opportunityToCrm(w.ctx, w.opportunity.id, { personId: arjun.personId })).leadId).toBe(lead.leadId);
    expect(await db.person.findUniqueOrThrow({ where: { id: arjun.personId } })).toMatchObject({ linkedinUrl: "https://www.linkedin.com/in/arjun-synthetic" });
    expect(await db.contactMethod.count({ where: { personId: arjun.personId } })).toBe(0);
  });

  it("works with Apify alone: no Hunter or SignalHire, the LinkedIn posts token reused, and a free access check", async () => {
    const w = await atzean(); const fake = apify();
    const caps = await getCapabilities(w.ctx);
    expect(caps.contact_enrichment.providers.map(p => p.id)).toEqual(["apify_enrichment"]);
    expect(caps.company_research.state).not.toBe("not_built");
    expect(await testOpportunityProvider(w.ctx, "apify_enrichment")).toMatchObject({ ok: true, message: expect.stringContaining("Nothing was run or charged") });
    expect(fake.starts).toHaveLength(0);
  });

  it("reports a missing setup as setup, distinct from an empty result", async () => {
    const w = await atzean({ enrichment: false }); apify();
    await expect(startEnrichment(w.ctx, w.opportunity.id, { kind: "research" })).rejects.toMatchObject({ code: "not_connected", message: expect.stringContaining("Apify enrichment is not set up") });
  });

  it("keeps runs, people and contacts inside their workspace", async () => {
    const w = await atzean(); const other = await atzean(); apify();
    const run = await press(w, "enrich");
    await expect(getEnrichmentRun(other.ctx, run.id)).rejects.toMatchObject({ status: 404 });
    await expect(getOpportunityEnrichment(other.ctx, w.opportunity.id)).rejects.toMatchObject({ status: 404 });
    await expect(selectEnrichmentCompany(other.ctx, run.id, { index: 0 })).rejects.toMatchObject({ status: 404 });
    const theirs = await getOpportunityEnrichment(other.ctx, other.opportunity.id);
    expect(theirs.people).toEqual([]); expect(theirs.contactPoints).toEqual([]);
    expect(await db.apifyRun.count({ where: { workspaceId: other.workspace.id } })).toBe(0);
  });
});
