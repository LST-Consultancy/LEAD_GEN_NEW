/**
 * Adapter contract tests: each provider adapter against its vendor's *documented* example
 * responses and error bodies (docs checked 2026-09-25), replayed at the fetch level so the real
 * HTTP layer, URL allowlist, rate limiting and error-code extraction run too. These are not
 * captures of live traffic and prove nothing about a live account — see docs/provider-contracts.md.
 * No request leaves the process.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { hunterCalls } from "@/lib/providers/hunter-extra";
import { apolloProvider } from "@/lib/providers/apollo";
import { signalHireProvider } from "@/lib/providers/signalhire";
import { ProviderRequestError } from "@/lib/providers/provider-errors";
import { classifyProviderError } from "@/lib/enrichment/provider-outcome";
import { apolloCompanyFields, apolloPerson, hunterCheck, hunterCompanyFields, hunterDomainPerson, signalHireCandidate, signalHireSearchPerson } from "@/lib/enrichment/provider-results";
import { isQueueConfigured } from "@/lib/queue/connection";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
let ws = "";
beforeAll(async () => { const w = await makeWorkspace("ProviderReplays"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id); ws = w.workspace.id; });
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
afterEach(() => { vi.unstubAllGlobals(); });

type Seen = { url: URL; method: string; headers: Record<string, string>; body: unknown };
/** Replays one response per request, in order, and records what was sent. */
function replay(...responses: { status?: number; body: unknown }[]) {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    seen.push({ url: new URL(String(input)), method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses.shift() ?? { status: 500, body: { error: "test: no more replays" } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }));
  return seen;
}
const needsRedis = () => { if (!isQueueConfigured()) throw new Error("Provider replays need the test Redis (db 15): providerJson refuses to run without shared limits."); };

describe("Hunter adapter", () => {
  it("Domain Finder: sends company + key as query parameters and maps the documented data[]", async () => {
    needsRedis();
    const seen = replay({ body: { data: [{ domain: "stripe.com", company_name: "Stripe", email_count: 1234 }], meta: { params: { company: "Stripe" } } } });
    const out = await hunterCalls(ws, "hk").domainFinder("Stripe");
    expect(out).toEqual([expect.objectContaining({ domain: "stripe.com", company_name: "Stripe" })]);
    expect(seen[0].url.pathname).toBe("/v2/domain-finder");
    expect(seen[0].url.searchParams.get("company")).toBe("Stripe");
    expect(seen[0].url.searchParams.get("api_key")).toBe("hk");
  });

  it("Company Enrichment and Domain Search map to company fields and people", async () => {
    needsRedis();
    replay({ body: { data: { name: "Hunter", domain: "hunter.io", description: "Find email addresses", category: { sector: "Information Technology", industry: "Internet Software & Services" }, geo: { city: "Paris", state: null, country: "France" }, linkedin: { handle: "company/hunterio" }, metrics: { employees: "11-50", employeesCount: null } } } },
      { body: { data: { domain: "hunter.io", organization: "Hunter", accept_all: false, emails: [{ value: "antoine@hunter.io", type: "personal", confidence: 94, first_name: "Antoine", last_name: "Finkelstein", position: "Founder & CEO", seniority: "executive", department: "executive", linkedin: "https://www.linkedin.com/in/antoinefinkelstein", verification: { status: "valid", date: "2026-09-01" } }, { value: "noname@hunter.io", type: "personal", confidence: 40 }] }, meta: { results: 2, limit: 10, offset: 0 } } });
    const co = hunterCompanyFields(await hunterCalls(ws, "hk").companyFind("hunter.io"));
    expect(co).toMatchObject({ name: "Hunter", industry: "Internet Software & Services", city: "Paris", country: "France", linkedinUrl: "https://www.linkedin.com/company/hunterio", employeeBand: "11-50", employeeCount: null });
    const ds = await hunterCalls(ws, "hk").domainSearch("hunter.io", 10);
    const people = ds.emails.map(e => hunterDomainPerson(e, "hunter.io")).filter(Boolean);
    // An address with no name is not a person.
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ fullName: "Antoine Finkelstein", title: "Founder & CEO", profileKey: expect.stringContaining("antoinefinkelstein"), emails: [{ email: "antoine@hunter.io", providerStatus: "valid" }], employer: { domain: "hunter.io", current: null } });
  });

  it("Email Verifier: every documented status maps to one of the seven outcomes, and only 'valid' confirms a mailbox", async () => {
    needsRedis();
    replay({ body: { data: { status: "accept_all", result: "risky", score: 50, smtp_check: true, accept_all: true, disposable: false, webmail: false, block: false } } });
    expect(hunterCheck(await hunterCalls(ws, "hk").verify("a@b.example")).result).toBe("CATCH_ALL");
    expect(["valid", "invalid", "accept_all", "webmail", "disposable", "unknown"].map(status => hunterCheck({ status }).result)).toEqual(["MAILBOX_CONFIRMED", "INVALID", "CATCH_ALL", "UNKNOWN", "UNKNOWN", "UNKNOWN"]);
  });

  it("errors: the documented error ids are kept, so a rate-limit 403 is not read as a plan problem", async () => {
    needsRedis();
    replay({ status: 403, body: { errors: [{ id: "rate_limit", code: 403, details: "You have reached the rate limit." }] } });
    const e = await hunterCalls(ws, "hk").domainFinder("x").catch(err => err);
    expect(e).toBeInstanceOf(ProviderRequestError);
    expect(e).toMatchObject({ status: 403, providerCode: "rate_limit" });
    expect(classifyProviderError("hunter", e).outcome).toBe("rate_limited");
    replay({ status: 401, body: { errors: [{ id: "authentication_failed", code: 401 }] } });
    expect(classifyProviderError("hunter", await hunterCalls(ws, "bad").domainFinder("x").catch(err => err)).outcome).toBe("invalid_credentials");
  });

  it("a changed response shape is reported as malformed, not as an empty result", async () => {
    needsRedis();
    replay({ body: { data: { emails: "not-a-list" } } });
    await expect(hunterCalls(ws, "hk").domainSearch("hunter.io")).rejects.toBeInstanceOf(ZodError);
  });
});

describe("Apollo adapter", () => {
  it("People API Search: sends the domain and titles in the body with the key in a header, never in the URL", async () => {
    needsRedis();
    const seen = replay({ body: { total_entries: 1, people: [{ id: "64a7ff0cc4dfae00013df1a5", first_name: "Tim", last_name_obfuscated: "Za***i", title: "CEO", has_email: true, organization: { name: "Apollo" } }] } });
    const people = await apolloProvider(ws, "ak").peopleSearch("apollo.io", ["CEO"], 5);
    expect(people[0]).toMatchObject({ id: "64a7ff0cc4dfae00013df1a5", last_name_obfuscated: "Za***i" });
    expect(seen[0].url.pathname).toBe("/api/v1/mixed_people/api_search");
    expect(seen[0].url.search).toBe("");
    expect(seen[0].headers["x-api-key"]).toBe("ak");
    expect(seen[0].body).toMatchObject({ q_organization_domains_list: ["apollo.io"], person_titles: ["CEO"], per_page: 5, page: 1 });
  });

  it("People Enrichment by id: maps name, employer and an unlocked email; a locked one is not an address", async () => {
    needsRedis();
    replay({ body: { person: { id: "p1", first_name: "Tim", last_name: "Zheng", name: "Tim Zheng", title: "Founder & CEO", linkedin_url: "http://www.linkedin.com/in/tim-zheng-677ba010", email: "tim@apollo.io", email_status: "verified", organization: { name: "Apollo", primary_domain: "apollo.io", linkedin_url: "http://www.linkedin.com/company/apolloio" } } } },
      { body: { person: { id: "p2", first_name: "Ann", last_name: "Lee", name: "Ann Lee", email: "email_not_unlocked@domain.com", email_status: "unavailable" } } });
    const a = await apolloProvider(ws, "ak").matchById("p1");
    expect(apolloPerson(a.person!, a.confidence)).toMatchObject({ fullName: "Tim Zheng", emails: [{ email: "tim@apollo.io", providerStatus: "verified" }], employer: { name: "Apollo", domain: "apollo.io" } });
    const b = await apolloProvider(ws, "ak").matchById("p2");
    expect(apolloPerson(b.person!, b.confidence)!.emails).toEqual([]);
  });

  it("Organization Enrichment maps the documented fields; a 403 for scope is not entitled", async () => {
    needsRedis();
    replay({ body: { organization: { id: "5e66b6381e05b4008c8331b8", name: "Apollo.io", website_url: "http://www.apollo.io", primary_domain: "apollo.io", linkedin_url: "http://www.linkedin.com/company/apolloio", industry: "information technology & services", estimated_num_employees: 1600, city: "San Francisco", state: "California", country: "United States", short_description: "Apollo.io combines…" } } });
    expect(apolloCompanyFields((await apolloProvider(ws, "ak").orgEnrich("apollo.io"))!)).toMatchObject({ name: "Apollo.io", domain: "apollo.io", employeeCount: 1600, city: "San Francisco", linkedinUrl: expect.stringContaining("linkedin.com/company/apolloio") });
    replay({ status: 403, body: { error: "api/v1/mixed_people/api_search is not accessible with this api_key", error_code: "API_INACCESSIBLE" } });
    const e = await apolloProvider(ws, "ak").peopleSearch("apollo.io", [], 5).catch(err => err);
    expect(e).toMatchObject({ status: 403, providerCode: "API_INACCESSIBLE" });
    expect(classifyProviderError("apollo", e)).toMatchObject({ outcome: "not_entitled", detail: expect.stringContaining("scope") });
  });

  it("a POST is never retried, so a paid call is made at most once per attempt", async () => {
    needsRedis();
    const seen = replay({ status: 503, body: {} }, { body: { person: null } });
    await expect(apolloProvider(ws, "ak").matchById("p1")).rejects.toMatchObject({ status: 503 });
    expect(seen).toHaveLength(1);
  });
});

describe("SignalHire adapter", () => {
  it("Search by query: quotes the company, ORs the titles, and a first role naming the company counts as current", async () => {
    needsRedis();
    const seen = replay({ body: { requestId: 1, total: 2, profiles: [{ uid: "a".repeat(32), fullName: "Jane Roe", location: "Pune, Maharashtra, India", experience: [{ company: "Atzean Technologies", title: "CTO" }, { company: "OldCo", title: "Engineer" }], contactsFetched: null }, { uid: "b".repeat(32), fullName: "Sam Poe", experience: [{ company: "Elsewhere", title: "CTO" }, { company: "Atzean Technologies", title: "Dev" }] }] } });
    const profiles = await signalHireProvider(ws, "sk").searchPeople("Atzean Technologies", ["Head of Delivery", "CTO"], 5);
    expect(seen[0].url.pathname).toBe("/api/v1/candidate/searchByQuery");
    expect(seen[0].headers.apikey).toBe("sk");
    expect(seen[0].body).toMatchObject({ currentCompany: '"Atzean Technologies"', currentTitle: '"Head of Delivery" OR CTO', size: 5 });
    const mapped = profiles.map(p => signalHireSearchPerson(p, "Atzean Technologies LLP")!);
    expect(mapped.map(p => [p.fullName, p.atCompany, p.city])).toEqual([["Jane Roe", true, "Pune"], ["Sam Poe", false, null]]);
  });

  it("Person API: synchronous mode, work emails only, 'n/a' is treated as missing, and credits_are_over is quota", async () => {
    needsRedis();
    const seen = replay({ body: [{ item: "https://www.linkedin.com/in/jane-roe", status: "success", candidate: { uid: "c".repeat(32), fullName: "Jane Roe", headLine: "CTO", locations: [{ name: "Pune, India" }], social: [{ type: "li", link: "https://www.linkedin.com/in/jane-roe", rating: 100 }], experience: [{ position: "CTO", company: "Atzean Technologies", current: true, website: "n/a", companyUrl: "https://www.linkedin.com/company/atzean" }], contacts: [{ type: "email", value: "jane@atzean.example", rating: 100, subType: "work" }, { type: "email", value: "jane@gmail.example", rating: 90, subType: "personal" }, { type: "phone", value: "+910000000000", rating: 80, subType: "mobile" }] } }] });
    const r = await signalHireProvider(ws, "sk").lookupByLinkedIn("https://www.linkedin.com/in/jane-roe");
    expect(seen[0].body).toEqual({ items: ["https://www.linkedin.com/in/jane-roe"], withoutWaterfall: true });
    const p = signalHireCandidate(r.candidate!);
    expect(p.emails.map(e => e.email)).toEqual(["jane@atzean.example"]);
    expect(p.employer).toMatchObject({ name: "Atzean Technologies", domain: null, current: true, linkedinUrl: expect.stringContaining("/company/atzean") });
    replay({ body: [{ item: "x", status: "credits_are_over" }] });
    expect((await signalHireProvider(ws, "sk").lookupByLinkedIn("x")).status).toBe("credits_are_over");
    replay({ status: 402, body: { error: "Out of credits" } });
    expect(classifyProviderError("signalhire", await signalHireProvider(ws, "sk").lookupByUid("u").catch(e => e)).outcome).toBe("quota");
  });

  it("a candidate whose experience has no company name still parses", async () => {
    expect(signalHireCandidate({ uid: "d".repeat(32), fullName: "No Company", experience: [{ company: null, position: "Freelancer", current: true }] }).employer).toMatchObject({ name: null, current: true });
  });
});

describe("request safety", () => {
  it("refuses any host outside the allowlist before a request is made", async () => {
    const seen = replay({ body: {} });
    const { providerJson } = await import("@/lib/providers/http");
    await expect(providerJson(ws, "hunter", "https://evil.example/v2/domain-finder")).rejects.toThrow(/not permitted/);
    expect(seen).toHaveLength(0);
  });
  it("records each request in the provider sync log with only the error id, never the response body", async () => {
    needsRedis();
    replay({ status: 403, body: { errors: [{ id: "rate_limit", details: "secret-looking detail jane@atzean.example" }] } });
    await hunterCalls(ws, "hk").domainFinder("x").catch(() => null);
    const row = await db.providerSync.findFirstOrThrow({ where: { workspaceId: ws, provider: "hunter", state: "FAILED" }, orderBy: { startedAt: "desc" } });
    expect(row.error).toBe("HTTP 403 (rate_limit)");
  });
});
