import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/providers/http", async (original) => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
vi.mock("@/lib/ai/complete", async (original) => ({ ...(await original<typeof import("@/lib/ai/complete")>()), complete: vi.fn() }));
import { providerJson } from "@/lib/providers/http";
import { ProviderRequestError } from "@/lib/providers/provider-errors";
import { complete } from "@/lib/ai/complete";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { connectOpportunityProvider, testOpportunityProvider } from "@/lib/services/opportunity-providers";
import { cancelEnrichment, decideContactPoint, decideEmailDomain, getEnrichmentRun, getOpportunityEnrichment, retryEnrichment, selectEnrichmentCompany, startEnrichment } from "@/lib/services/enrichment";
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

  it("D02: a same-name domain is accepted only when the company's own website publishes it; the same label elsewhere stays in review, and a later official sighting promotes it", async () => {
    const w = await atzean();
    // The post (not official) mentions a same-label address under another ending.
    await db.opportunitySource.updateMany({ where: { opportunityId: w.opportunity.id }, data: { description: `${POST_TEXT}\nOr write to neha.rao@atzean-synthetic.co.uk` } });
    apify({ "automation-lab/website-contact-finder": () => [{ ...WEBSITE_ITEMS[0], emails: ["neha.rao@atzean-synthetic.in"] }] });
    await press(w, "people"); await press(w, "emails");
    const domains = () => db.company.findUniqueOrThrow({ where: { id: w.company.id } }).then(c => (c.enrichment as { emailDomains: { domain: string; status: string }[] }).emailDomains);
    expect(await domains()).toEqual(expect.arrayContaining([expect.objectContaining({ domain: "atzean-synthetic.in", status: "alias" }), expect.objectContaining({ domain: "atzean-synthetic.co.uk", status: "review" })]));
    // Retained, not discarded, while it waits for review.
    expect(await db.companyContactPoint.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "neha.rao@atzean-synthetic.co.uk" } })).toMatchObject({ domainStatus: "review" });
    // The company's own site later publishes an address there: the pending review is promoted.
    apify({ "automation-lab/website-contact-finder": () => [{ ...WEBSITE_ITEMS[0], emails: ["sales.team@atzean-synthetic.co.uk"] }] });
    await press(w, "emails", true);
    expect((await domains()).find(d => d.domain === "atzean-synthetic.co.uk")).toMatchObject({ status: "alias" });
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
    expect(calls.find(c => c.provider === "signalhire" && c.url.endsWith("/candidate/search"))?.body).toMatchObject({ withoutWaterfall: true });
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
    expect(s.reason).toContain("credits or quota used up");
    expect(await db.contactMethod.count({ where: { workspaceId: w.workspace.id, value: "hr@atzean-synthetic.example" } })).toBe(0);
    expect(await db.companyContactPoint.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "hr@atzean-synthetic.example" } })).toMatchObject({ isGeneric: true });
  });
});

describe("Stage-level fallback", () => {
  type Answer = (url: URL, body?: Record<string, unknown>) => unknown;
  /** Apify fakes (with overrides) plus provider answers routed by provider and path; records every provider call. */
  function stack(answers: Partial<Record<"signalhire" | "hunter" | "apollo", Answer>>, over: Parameters<typeof apify>[0] = {}) {
    const fake = apify(over); const calls: { provider: string; url: URL; body?: Record<string, unknown> }[] = [];
    vi.mocked(providerJson).mockImplementation((async (ws: string, provider: string, url: string, headers?: Record<string, string>, body?: Record<string, unknown>) => {
      if (provider in answers) { const u = new URL(url); calls.push({ provider, url: u, body }); const out = answers[provider as keyof typeof answers]!(u, body); if (out instanceof Error) throw out; return out; }
      return fake.handler(ws, provider, url, headers, body);
    }) as never);
    return { fake, calls, paid: () => calls.filter(c => !/domain-finder|api_search|searchByQuery/.test(c.url.pathname)) };
  }
  async function enable(w: Awaited<ReturnType<typeof atzean>>, fallback: Record<string, unknown>, providers: ("signalhire" | "hunter" | "apollo")[]) {
    await connectOpportunityProvider(w.ctx, "apify_enrichment", { config: { fallback: { enabled: true, ...fallback } }, allowedSearch: true, allowedStorage: true, allowedEnrichment: true });
    for (const p of providers) await connectOpportunityProvider(w.ctx, p, { apiKey: `${p}-test-key`, config: {}, allowedSearch: true, allowedStorage: true, allowedEnrichment: true });
  }
  const noWebsiteEmails = { "automation-lab/website-contact-finder": () => [{ ...WEBSITE_ITEMS[0], emails: [] }] };
  /** Hunter with nothing to say except what a test adds. */
  const hunter = (extra: Answer = () => undefined): Answer => (u, b) => {
    const out = extra(u, b); if (out !== undefined) return out;
    if (u.pathname.endsWith("/domain-search")) return { data: { emails: [] } };
    if (u.pathname.endsWith("/domain-finder")) return { data: [] };
    if (u.pathname.endsWith("/email-finder")) return { data: { email: null } };
    return new ProviderRequestError("404", "http", 404);
  };

  it("D03: Apify finds no email, Hunter finds one — the run completes with results and the address is on the person", async () => {
    const w = await atzean();
    await db.opportunitySource.updateMany({ where: { opportunityId: w.opportunity.id }, data: { description: "We are looking for IT staffing partners for contract Java developers in Pune." } });
    stack({ hunter: hunter(u => (u.pathname.endsWith("/email-finder") && u.searchParams.get("first_name") === "Riya" ? { data: { email: "riya.s@atzean-synthetic.example", score: 91, verification: { status: "valid" } } } : undefined)) }, noWebsiteEmails);
    await enable(w, { order: ["hunter"], maxLookupsPerRun: 5 }, ["hunter"]);
    await press(w, "people");
    const run = await press(w, "emails");
    expect(stage(run, "emails").status).toBe("no_matches");
    expect(stage(run, "contacts")).toMatchObject({ status: "done", counts: { found: 1, hunter_found: 1 } });
    expect(run.state).toBe("COMPLETED");
    expect(stage(run, "contacts").attempts).toEqual(expect.arrayContaining([expect.objectContaining({ provider: "hunter", operation: "emails", target: "Riya Synthetic", outcome: "found" })]));
    const snap = await getOpportunityEnrichment(w.ctx, w.opportunity.id);
    const riya = snap.people.find(p => p.name === "Riya Synthetic")!;
    expect(riya.contacts).toEqual([expect.objectContaining({ value: "riya.s@atzean-synthetic.example", verificationResult: "UNCHECKED", provenance: expect.objectContaining({ identity: expect.objectContaining({ level: "supported", provider: "hunter" }) }) })]);
    expect((run.result as { contactDecisions: { name: string; action: string }[] }).contactDecisions).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Riya Synthetic", action: "found" })]));
  });

  it("D04: a provider's person with a different LinkedIn profile, or a low-confidence match, is held for review and the next provider is still tried", async () => {
    const w = await atzean();
    stack({
      apollo: (u, b) => (u.pathname.endsWith("/people/match") ? (b?.linkedin_url === "https://www.linkedin.com/in/arjun-synthetic"
        ? { person: { id: "ap-other", first_name: "Arjun", name: "Arjun", linkedin_url: "https://www.linkedin.com/in/arjun-someone-else", email: "arjun.k@atzean-synthetic.example", email_status: "verified", organization: { name: "Atzean Technologies LLP" } }, match_confidence: "high" }
        : { person: { id: "ap-low", first_name: "Riya", last_name: "Synthetic", name: "Riya Synthetic", email: "r.synthetic@atzean-synthetic.example", organization: { name: "Atzean Technologies LLP" } }, match_confidence: "low" }) : { people: [] }),
      signalhire: (u, b) => (u.pathname.endsWith("/candidate/search") && (b?.items as string[])[0].includes("arjun") ? [{ item: "x", status: "success", candidate: { uid: "b".repeat(32), fullName: "Arjun", contacts: [{ type: "email", value: "arjun@atzean-synthetic.example", subType: "work" }] } }] : u.pathname.endsWith("/searchByQuery") ? { profiles: [] } : [{ item: "x", status: "failed" }]),
    }, noWebsiteEmails);
    await enable(w, { order: ["apollo", "signalhire"], maxLookupsPerRun: 10 }, ["apollo", "signalhire"]);
    await press(w, "people");
    const run = await press(w, "emails");
    const arjun = await db.person.findFirstOrThrow({ where: { workspaceId: w.workspace.id, fullName: "Arjun" }, include: { contactMethods: true } });
    // Apollo's Arjun is someone else: his address is not attached, but kept on the company naming Arjun as a possible owner.
    expect(arjun.contactMethods.map(m => m.value)).toEqual(["arjun@atzean-synthetic.example"]);
    const held = await db.companyContactPoint.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "arjun.k@atzean-synthetic.example" } });
    expect(held).toMatchObject({ possiblePersonId: arjun.id, evidence: expect.objectContaining({ review: expect.objectContaining({ identity: expect.objectContaining({ level: "conflict" }) }) }) });
    // A low-confidence match with nothing else to go on is not attached either.
    expect(await db.contactMethod.count({ where: { workspaceId: w.workspace.id, value: "r.synthetic@atzean-synthetic.example" } })).toBe(0);
    expect(await db.companyContactPoint.findFirstOrThrow({ where: { workspaceId: w.workspace.id, value: "r.synthetic@atzean-synthetic.example" } })).toMatchObject({ evidence: expect.objectContaining({ review: expect.objectContaining({ identity: expect.objectContaining({ level: "weak" }) }) }) });
    expect(stage(run, "contacts").counts).toMatchObject({ found: 1, review: expect.any(Number) });
    const decisions = (run.result as { contactDecisions: { name: string; action: string }[] }).contactDecisions;
    expect(decisions.find(d => d.name === "Arjun")).toMatchObject({ action: "found" });
    expect(decisions.find(d => d.name === "Riya Synthetic")).toMatchObject({ action: "review" });
    // A person settles it: another workspace cannot, attaching records who decided, and the decision is final.
    const other = await atzean();
    await expect(decideContactPoint(other.ctx, w.opportunity.id, { pointId: held.id, decision: "attach" })).rejects.toThrow();
    await decideContactPoint(w.ctx, w.opportunity.id, { pointId: held.id, decision: "attach" });
    expect(await db.contactMethod.findFirstOrThrow({ where: { workspaceId: w.workspace.id, personId: arjun.id, value: "arjun.k@atzean-synthetic.example" } })).toMatchObject({ provenance: expect.objectContaining({ ownership: expect.objectContaining({ basis: "confirmed_by_person", userId: w.user.id }) }) });
    await expect(decideContactPoint(w.ctx, w.opportunity.id, { pointId: held.id, decision: "dismiss" })).rejects.toThrow(/already decided/);
    expect((await getOpportunityEnrichment(w.ctx, w.opportunity.id)).contactPoints.some(p => p.id === held.id)).toBe(false);
    expect(await db.auditLog.count({ where: { workspaceId: w.workspace.id, action: "company.contact_point_decided" } })).toBe(1);
    expect(run.state).toBe("COMPLETED");
  });

  it("D05: a confirmed address is not searched again, an invalid one is replaced, a suppressed person is never searched — each with its reason", async () => {
    const w = await atzean();
    const { calls } = stack({ hunter: hunter(u => (u.pathname.endsWith("/email-finder") ? { data: { email: `${u.searchParams.get("first_name")!.toLowerCase()}.new@atzean-synthetic.example`, score: 80 } } : undefined)) }, noWebsiteEmails);
    await enable(w, { order: ["hunter"], maxLookupsPerRun: 10 }, ["hunter"]);
    await press(w, "people");
    const riya = await db.person.findFirstOrThrow({ where: { workspaceId: w.workspace.id, fullName: "Riya Synthetic" } });
    await db.contactMethod.create({ data: { workspaceId: w.workspace.id, personId: riya.id, kind: "WORK_EMAIL", value: "riya.old@atzean-synthetic.example", maskedValue: "r***@atzean-synthetic.example", source: "test", verificationResult: "INVALID", verifiedAt: new Date(), status: "FAILED" } });
    const run = await press(w, "emails");
    const decisions = (run.result as { contactDecisions: { name: string; action: string; reason: string }[] }).contactDecisions;
    expect(decisions.find(d => d.name === "Riya Synthetic")).toMatchObject({ action: "found", reason: expect.stringMatching(/invalid|bounc/i) });
    expect(await db.contactMethod.count({ where: { workspaceId: w.workspace.id, value: "riya.new@atzean-synthetic.example" } })).toBe(1);
    // Now confirmed: a second run does not ask again.
    await db.contactMethod.updateMany({ where: { workspaceId: w.workspace.id, value: "riya.new@atzean-synthetic.example" }, data: { verificationResult: "MAILBOX_CONFIRMED", verifiedAt: new Date(), status: "VERIFIED" } });
    await db.suppression.create({ data: { workspaceId: w.workspace.id, kind: "LINKEDIN", value: "https://www.linkedin.com/in/arjun-synthetic", reason: "Asked not to be contacted", source: "test" } });
    const before = calls.length;
    const again = await press(w, "emails", true);
    const d2 = (again.result as { contactDecisions: { name: string; action: string; reason: string }[] }).contactDecisions;
    expect(d2.find(d => d.name === "Riya Synthetic")).toMatchObject({ action: "skip" });
    expect(calls.slice(before).some(c => c.url.searchParams.get("first_name") === "Riya")).toBe(false);
    expect(d2.find(d => d.name === "Arjun")).toMatchObject({ action: "blocked" });
  });

  it("D01: Apify finds no company; Hunter's name match is offered for a person to choose, never auto-accepted, and the choice is final", async () => {
    const w = await atzean();
    await db.opportunitySource.updateMany({ where: { opportunityId: w.opportunity.id }, data: { description: "We need IT staffing partners for contract Java developers in Pune." } });
    stack({ hunter: hunter(u => (u.pathname.endsWith("/domain-finder") ? { data: [{ domain: "atzean-synthetic.example", company_name: "Atzean Technologies" }, { domain: "unrelated-synthetic.example", company_name: "Blue Harbour Foods" }] } : undefined)) },
      { "apify/google-search-scraper": () => [{ organicResults: [] }], "harvestapi/linkedin-company": () => [] });
    await enable(w, { order: ["signalhire", "hunter"] }, ["hunter"]);
    const run = await press(w, "research");
    expect(run.state).toBe("NEEDS_SELECTION");
    expect(stage(run, "resolve")).toMatchObject({ status: "needs_selection", reason: expect.stringContaining("A name alone is not proof") });
    // SignalHire cannot look a company up, and says so; a differently named company is not offered.
    expect(stage(run, "resolve").attempts).toEqual(expect.arrayContaining([expect.objectContaining({ provider: "signalhire", outcome: "unsupported" }), expect.objectContaining({ provider: "hunter", call: "Domain Finder", outcome: "found" })]));
    expect((run.result as { fallbackCandidates: { domain: string }[] }).fallbackCandidates.map(c => c.domain)).toEqual(["atzean-synthetic.example"]);
    expect((await db.company.findUniqueOrThrow({ where: { id: w.company.id } })).domain).toBeNull();
    if (!isQueueConfigured()) return;
    await selectEnrichmentCompany(w.ctx, run.id, { fallbackIndex: 0 });
    const c = await db.company.findUniqueOrThrow({ where: { id: w.company.id } });
    expect(c.domain).toBe("atzean-synthetic.example");
    expect((c.enrichment as { fields: { domain: { confirmedBy: string } } }).fields.domain.confirmedBy).toBe(w.user.id);
  });

  it("D01: a name match the opportunity's own source also names is accepted, and the details stage fills only missing fields", async () => {
    const w = await atzean();
    await db.opportunitySource.updateMany({ where: { opportunityId: w.opportunity.id }, data: { description: "We need IT staffing partners. See https://atzean-synthetic.example/careers" } });
    const { calls } = stack({ hunter: hunter(u => (u.pathname.endsWith("/domain-finder") ? { data: [{ domain: "atzean-synthetic.example", company_name: "Atzean Technologies LLP" }] }
      : u.pathname.endsWith("/companies/find") ? { data: { name: "Atzean Technologies LLP", category: { industry: "IT Services" }, geo: { city: "Pune", country: "India" }, metrics: { employeesCount: 40 } } } : undefined)) },
      { "apify/google-search-scraper": () => [{ organicResults: [] }], "harvestapi/linkedin-company": () => [] });
    await enable(w, { order: ["hunter"] }, ["hunter"]);
    const run = await press(w, "research");
    expect(stage(run, "resolve")).toMatchObject({ status: "done", reason: expect.stringContaining("also mentions") });
    const c = await db.company.findUniqueOrThrow({ where: { id: w.company.id } });
    expect(c).toMatchObject({ domain: "atzean-synthetic.example", industry: "IT Services", city: "Pune", employeeCount: 40 });
    expect(calls.filter(x => x.url.pathname.endsWith("/companies/find"))).toHaveLength(1);
    expect(["COMPLETED", "PARTIAL"]).toContain(run.state);
  });

  it("stops at the paid-lookup cap, records every attempt in the ledger, and does not bypass a disabled operation", async () => {
    const w = await atzean();
    const { paid } = stack({ hunter: hunter(u => (u.pathname.endsWith("/email-finder") ? { data: { email: null } } : undefined)) }, noWebsiteEmails);
    await enable(w, { order: ["hunter"], maxLookupsPerRun: 1 }, ["hunter"]);
    await press(w, "people");
    const run = await press(w, "emails");
    expect(stage(run, "contacts").attempts).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: "budget" })]));
    const rows = await db.providerCall.findMany({ where: { workspaceId: w.workspace.id, enrichmentRunId: run.id, units: { gt: 0 } } });
    expect(rows).toHaveLength(1);
    const before = paid().length;
    await enable(w, { order: ["hunter"], maxLookupsPerRun: 5, operations: { company: true, people: true, emails: false, verify: true } }, []);
    const off = await press(w, "emails", true);
    expect(stage(off, "contacts")).toMatchObject({ status: "skipped", reason: expect.stringContaining("switched off for finding emails") });
    expect(paid().length).toBe(before);
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
