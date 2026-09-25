import { describe, expect, it } from "vitest";
import { companyDomain, decide, evidenceLinks, linkedInCompanyUrl, mapCompanyProfile, nameSimilarity, parseSearchItems, safePublicHost, scoreCandidate, searchCandidates } from "@/lib/enrichment/identity";
import { assessAuthor, mapEmployee, rankPeople, roleFocus, roleFocuses, searchQueryFor } from "@/lib/enrichment/people";
import { classify, corroborateAlias, domainLabel, extractEmails, inferOwner, mapWebsiteItems, normalisePhone, ownerOf } from "@/lib/enrichment/emails";
import { importRowSchema } from "@/lib/ingest/import";
import { contactStatusFor, mapChecks } from "@/lib/enrichment/verification";
import { freshStages, runStateOf, type Stage } from "@/lib/enrichment/stages";
import { enrichmentConfigSchema, estimate } from "@/lib/enrichment/config";
import { addressDecision, type ExistingAddress } from "@/lib/enrichment/fallback";
import { ATZEAN, COMPANY_PAGE, EMPLOYEES, SEARCH_ITEMS, WEBSITE_ITEMS, VERIFY_ITEMS, POST_REFERENCE } from "./helpers/enrichment-fixture";

const ctx = { name: ATZEAN.name, evidenceDomains: [], evidenceLinkedin: [], searchWebsites: ["atzean-synthetic.example"], expectedCountry: "India", opportunityTerms: ["staffing", "IT"] };

describe("resolving which company this is", () => {
  it("reads a legal suffix as the same name, and a different name as different", () => {
    expect(nameSimilarity("Atzean Technologies LLP", "Atzean Technologies")).toBe("exact");
    expect(nameSimilarity("Atzean Technologies LLP", "Atzean Global Holdings")).not.toBe("exact");
    expect(nameSimilarity("Atzean Technologies LLP", "Northwind Traders")).toBe("different");
  });
  it("parses search results into LinkedIn pages and company websites, ignoring directories", () => {
    const found = searchCandidates(parseSearchItems(SEARCH_ITEMS), ATZEAN.name);
    expect(found.linkedin.map(l => l.url)).toEqual(["https://www.linkedin.com/company/atzean-technologies-synthetic"]);
    expect(found.websites.map(w => w.domain)).toEqual(["atzean-synthetic.example"]);
  });
  it("maps the documented company-page fields", () => {
    expect(mapCompanyProfile(COMPANY_PAGE)).toMatchObject({ linkedinUrl: "https://www.linkedin.com/company/atzean-technologies-synthetic", name: "Atzean Technologies LLP", domain: "atzean-synthetic.example", industry: "IT Services and IT Consulting", employeeCount: 45, employeeBand: "11–50", city: "Pune", country: "India" });
  });
  it("resolves only with corroboration: a name match alone is never enough", () => {
    const p = mapCompanyProfile(COMPANY_PAGE)!;
    const nameOnly = scoreCandidate(p, { ...ctx, searchWebsites: [], expectedCountry: null, opportunityTerms: [] });
    expect(nameOnly.score).toBe(40);
    expect(decide([nameOnly])).toMatchObject({ kind: "ambiguous" });
    expect(decide([scoreCandidate(p, ctx)])).toMatchObject({ kind: "resolved", best: { score: 70 } });
  });
  it("resolves the corroborated one of two namesakes, and counts a known conflict against the other", () => {
    const india = mapCompanyProfile({ ...COMPANY_PAGE, website: null })!;
    const uae = mapCompanyProfile({ ...COMPANY_PAGE, linkedinUrl: "https://www.linkedin.com/company/atzean-uae-synthetic", website: null, locations: [{ headquarter: true, parsed: { city: "Dubai", country: "United Arab Emirates" } }] })!;
    const d = decide([scoreCandidate(india, ctx), scoreCandidate(uae, ctx)]);
    expect(d).toMatchObject({ kind: "resolved", best: { profile: { country: "India" } } });
    if (d.kind === "resolved") expect(d.others[0].conflicts.join(" ")).toMatch(/not India/);
  });
  it("asks a person to choose between two equally plausible companies", () => {
    const a = mapCompanyProfile({ ...COMPANY_PAGE, website: null })!;
    const b = mapCompanyProfile({ ...COMPANY_PAGE, linkedinUrl: "https://www.linkedin.com/company/atzean-tech-pune-synthetic", website: null })!;
    const d = decide([scoreCandidate(a, ctx), scoreCandidate(b, ctx)]);
    expect(d).toMatchObject({ kind: "ambiguous", why: expect.stringContaining("More than one company fits") });
  });
  it("uses links written in the opportunity's own source as strong evidence", () => {
    const links = evidenceLinks([{ sourceUrl: "https://www.linkedin.com/posts/x", title: "", description: "Visit https://www.linkedin.com/company/atzean-technologies-synthetic/ or https://www.atzean-synthetic.example/about. Posted via https://lnkd.in/abc" }]);
    expect(links.linkedin[0].url).toBe("https://www.linkedin.com/company/atzean-technologies-synthetic");
    expect(links.websites.map(w => w.domain)).toEqual(["atzean-synthetic.example"]);
  });
  it("never hands a private address to a crawler", () => {
    for (const bad of ["http://127.0.0.1", "localhost", "intranet.corp", "files.internal", "http://[::1]/", "10.0.0.5", "printer"]) expect(safePublicHost(bad)).toBeNull();
    expect(companyDomain("https://jobs.netflix.com?utm=x")).toBe("netflix.com");
    expect(linkedInCompanyUrl("https://www.linkedin.com/posts/someone_activity-1")).toBeNull();
  });
});

describe("finding people", () => {
  const company = { name: ATZEAN.name, linkedinUrl: "https://www.linkedin.com/company/atzean-technologies-synthetic" };
  const people = EMPLOYEES.map(e => mapEmployee(e, company, "vendor_staffing", false)!);
  it("targets partnerships, procurement, delivery and talent for a staffing ask", () => {
    expect(roleFocus(["EXTERNAL_VENDOR", "STAFF_AUGMENTATION"])).toBe("vendor_staffing");
    expect(roleFocus(["IMPLEMENTATION"])).toBe("technology");
    expect(searchQueryFor("vendor_staffing", false)).toContain('"Talent Acquisition"');
    expect(searchQueryFor("vendor_staffing", true)).toContain("Founder");
  });
  it("tells current, former and uncertain associations apart", () => {
    expect(people.map(p => [p.fullName, p.association])).toEqual([["Riya Synthetic", "current"], ["Former Person", "former"], ["Unrelated Person", "uncertain"], ["Arjun", "current"]]);
  });
  it("keeps a person with no title, no last name and no email, recorded as missing", () => {
    const arjun = people[3];
    expect(arjun).toMatchObject({ title: "", lastName: null, emails: [], profileKey: "li:arjun-synthetic" });
    expect(arjun.authority.basis).toBe("No title to infer from.");
  });
  it("labels decision-making authority as an inference and never ranks a former employee first", () => {
    expect(people[0].authority).toMatchObject({ inferred: true });
    expect(people[0].authority.basis).toMatch(/Inferred from the title .*not confirmed/);
    expect(rankPeople(people, 4).at(-1)?.association).toBe("former");
  });
  it("does not read LinkedIn's profile ‘verified’ badge as an email or anything else", () => {
    expect(mapEmployee({ ...EMPLOYEES[0], verified: true }, company, "vendor_staffing", false)?.emails).toEqual([]);
  });
  it("considers the post's author only when their headline ties them to the buyer", () => {
    expect(assessAuthor(POST_REFERENCE, ATZEAN.name)).toMatchObject({ ok: true, name: "Riya Synthetic" });
    expect(assessAuthor({ ...POST_REFERENCE, authorHeadline: "Senior Recruiter at Hire-Fast Staffing" }, ATZEAN.name)).toMatchObject({ ok: false, why: expect.stringContaining("recruiter") });
    expect(assessAuthor({ ...POST_REFERENCE, authorHeadline: "Engineer at Northwind" }, ATZEAN.name)).toMatchObject({ ok: false });
  });
});

describe("discovering emails", () => {
  it("keeps role addresses as company contacts and person-like addresses apart", () => {
    const w = mapWebsiteItems(WEBSITE_ITEMS, "atzean-synthetic.example");
    const byEmail = Object.fromEntries(w.found.map(f => [f.email, f]));
    expect(byEmail["info@atzean-synthetic.example"]).toMatchObject({ generic: true, sameDomain: true });
    expect(byEmail["riya.synthetic@atzean-synthetic.example"]).toMatchObject({ generic: false, sameDomain: true });
    expect(byEmail["sales.lead@othercorp.example"]).toMatchObject({ sameDomain: false });
  });
  it("gives an address to a person only when it names them, and to nobody when two could fit", () => {
    const people = [{ id: "riya", fullName: "Riya Synthetic" }, { id: "arjun", fullName: "Arjun" }];
    expect(ownerOf("riya.synthetic@atzean-synthetic.example", people)).toBe("riya");
    expect(ownerOf("info@atzean-synthetic.example", people)).toBeNull();
    expect(ownerOf("karan.mehta@atzean-synthetic.example", people)).toBeNull();
    expect(ownerOf("riya.s@x.example", [...people, { id: "riya2", fullName: "Riya Sen" }])).toBeNull();
  });
  it("extracts addresses written in the source with the passage they appear in, and ignores placeholders", () => {
    const found = extractEmails("Send profiles to partners@atzean-synthetic.example or name@example.com", "atzean-synthetic.example", { kind: "source", url: "https://www.linkedin.com/posts/x" });
    expect(found.map(f => f.email)).toEqual(["partners@atzean-synthetic.example"]);
    expect(found[0].evidence.excerpt).toContain("Send profiles to");
  });
});

describe("checking emails", () => {
  it("keeps the seven outcomes apart and never treats a format or MX pass as a confirmed mailbox", () => {
    const checks = Object.fromEntries(mapChecks(VERIFY_ITEMS, "bounceverify").map(c => [c.email, c.result]));
    expect(checks).toEqual({
      "riya.synthetic@atzean-synthetic.example": "MAILBOX_CONFIRMED", "info@atzean-synthetic.example": "CATCH_ALL", "careers@atzean-synthetic.example": "INCONCLUSIVE",
      "karan.mehta@atzean-synthetic.example": "INVALID", "partners@atzean-synthetic.example": "DOMAIN_VALID", "format.only@atzean-synthetic.example": "SYNTAX_VALID", "odd@atzean-synthetic.example": "UNKNOWN",
    });
    expect(contactStatusFor("DOMAIN_VALID")).toBe("UNVERIFIED");
    expect(contactStatusFor("CATCH_ALL")).toBe("UNVERIFIED");
    expect(contactStatusFor("MAILBOX_CONFIRMED")).toBe("VERIFIED");
  });
  it("reads michael.g's documented technical_status the same way", () => {
    expect(mapChecks([{ email: "a@b.example", technical_status: "unknown", reason: "smtp_unreachable" }, { email: "c@b.example", technical_status: "catch_all" }, { email: "d@b.example", technical_status: "valid" }], "michael_g").map(c => c.result)).toEqual(["INCONCLUSIVE", "CATCH_ALL", "MAILBOX_CONFIRMED"]);
  });
});

describe("a run's state", () => {
  const withStatus = (kind: "enrich" | "people", statuses: Stage["status"][]) => freshStages(kind).map((s, i) => ({ ...s, status: statuses[i] ?? "done" }));
  it("is partial when a later step fails after earlier ones saved results", () => {
    expect(runStateOf("enrich", withStatus("enrich", ["done", "done", "done", "done", "failed", "skipped"]))).toBe("PARTIAL");
  });
  it("is no matches when the step asked for found nothing, and needs a choice when the company is ambiguous", () => {
    expect(runStateOf("people", withStatus("people", ["skipped", "skipped", "no_matches"]))).toBe("NO_MATCHES");
    expect(runStateOf("people", withStatus("people", ["needs_selection", "blocked", "blocked"]))).toBe("NEEDS_SELECTION");
  });
});

describe("configuration", () => {
  it("defaults to Apify Actors only, with a bounded budget and auto-enrichment off", () => {
    const c = enrichmentConfigSchema.parse({});
    expect(Object.values(c.actors).every(a => /^[\w.-]+\/[\w.-]+$/.test(a))).toBe(true);
    expect(c).toMatchObject({ maxUsdPerRun: 1, autoEnrich: { enabled: false } });
    expect(() => enrichmentConfigSchema.parse({ actors: { search: "https://evil.example/actor" } })).toThrow();
    expect(estimate.employees(20, "Full ($8 per 1k)")).toBeCloseTo(0.18, 3);
  });
});

// Shapes as the Actors actually return them (field names confirmed against recorded datasets;
// values synthetic). The earlier mapper read `experience`/`headline`, which Short mode never sends.
describe("contact-quality regressions (E01–E06)", () => {
  const company = { name: "Atzean Technologies LLP", linkedinUrl: "https://www.linkedin.com/company/atzean-technologies-synthetic" };
  const shortItem = (over: Record<string, unknown> = {}) => ({
    firstName: "Asha", lastName: "Kulkarni", linkedinUrl: "https://www.linkedin.com/in/asha-synthetic",
    location: { linkedinText: "Pune, Maharashtra, India" },
    currentPositions: [{ title: "Head of Delivery", companyName: "Atzean Technologies", companyLinkedinUrl: company.linkedinUrl, current: true, startedOn: { month: 3, year: 2022 } }],
    ...over,
  });

  it("E02: reads a current role from currentPositions and a city from linkedinText", () => {
    const p = mapEmployee(shortItem(), company, "vendor_staffing", false);
    expect(p).toMatchObject({ title: "Head of Delivery", association: "current" });
    expect(p?.city ?? "").toMatch(/Pune/);
  });
  it("E02: a position marked current:false is former, and never ranked as a decision maker", () => {
    const p = mapEmployee(shortItem({ currentPositions: [{ title: "Head of Delivery", companyName: "Atzean Technologies", companyLinkedinUrl: company.linkedinUrl, current: false }] }), company, "vendor_staffing", false);
    expect(p?.association).not.toBe("current");
    expect(p?.authority.likelyDecisionMaker ?? false).toBe(false);
  });
  it("E02: reads industries given as objects and a phone given as {number}", () => {
    const profile = mapCompanyProfile({ ...COMPANY_PAGE, industries: [{ id: 96, name: "IT Services and IT Consulting", urn: "urn:li:industry:96" }], phone: { number: "+91 20 1234 5678" } });
    expect(profile).toMatchObject({ industry: "IT Services and IT Consulting", phone: "+91 20 1234 5678" });
  });
  it("E03: a staffing ask that also names a technology targets both vendor and technology roles", () => {
    const focus = roleFocuses(["INTERNAL_HIRING", "TECHNOLOGY"], "Looking for a staffing vendor to supply Java developers");
    expect(focus).toContain("vendor_staffing");
    expect(searchQueryFor(focus, false)).toMatch(/Partnerships|Vendor|Procurement/);
  });
  it("E01: keeps an address on another domain for review instead of dropping it", () => {
    const [f] = extractEmails("write to asha@othercorp.example", "atzean.com", { kind: "source", url: null });
    expect(f).toMatchObject({ domainStatus: "review", sameDomain: false });
  });
  it("D02: a matching name under another ending is not accepted on its own — it goes to review", () => {
    expect(domainLabel("atzean.in")).toBe(domainLabel("atzean.com"));
    expect(domainLabel("atzean.co.in")).toBe("atzean");
    // Unrelated companies can share a label: a post mentioning atzean.in proves nothing about atzean.com.
    const fromPost = corroborateAlias("atzean.in", "atzean.com", "Atzean Technologies", "source", "https://www.linkedin.com/posts/x");
    expect(fromPost).toMatchObject({ accepted: false, official: false, basis: expect.stringContaining("does not show the same owner") });
    // Even an employee-search or provider hit is not the company speaking.
    expect(corroborateAlias("atzean.in", "atzean.com", "Atzean Technologies", "employee_search").accepted).toBe(false);
    expect(corroborateAlias("atzean.in", "atzean.com", "Atzean Technologies", "provider").accepted).toBe(false);
  });
  it("D02: a company that really uses a different email domain is accepted when it publishes it itself", () => {
    // The company's own website (a page on its own domain) lists an address on its other domain.
    expect(corroborateAlias("atzean.in", "atzean.com", "Atzean Technologies", "website", "https://www.atzean.com/contact")).toMatchObject({ accepted: true, official: true });
    // A website domain and email domain can differ entirely, as long as the email one is the company's name.
    expect(corroborateAlias("northwind.com", "northwindcloud.io", "Northwind", "company_profile", null)).toMatchObject({ accepted: true, official: true });
  });
  it("D02: a page that only claims to be the website, or a partner address on it, is not enough", () => {
    // Evidence labelled "website" but from someone else's site is not the company's own publication.
    expect(corroborateAlias("atzean.in", "atzean.com", "Atzean Technologies", "website", "https://directory.example/atzean").accepted).toBe(false);
    // The company's site publishing its vendor's address does not make the vendor's domain the company's.
    expect(corroborateAlias("zendesk.com", "atzean.com", "Atzean Technologies", "website", "https://atzean.com/support")).toMatchObject({ accepted: false, official: true, basis: expect.stringContaining("partner") });
  });
  it("classifies an address on a corroborated alias as the company's", () => {
    expect(classify("asha@atzean.in", "atzean.com", { kind: "source", url: null, excerpt: null }, ["atzean.in"]).domainStatus).toBe("alias");
  });
  it("E05: a provider-returned role address is still generic", () => {
    expect(classify("sales@atzean.com", "atzean.com", { kind: "provider", url: null, excerpt: null, provider: "hunter" }).generic).toBe(true);
    expect(classify("x@gmail.com", "atzean.com", { kind: "provider", url: null, excerpt: null }).domainStatus).toBe("free");
  });
  it("E04: first name plus last initial is too weak to attach an address", () => {
    const people = [{ id: "p1", fullName: "Asha Kulkarni" }];
    expect(inferOwner("asha.kulkarni@atzean.com", people)).toEqual({ personId: "p1", strength: "full_name" });
    expect(inferOwner("ashak@atzean.com", people)?.strength).toBe("first_last_initial");
    expect(inferOwner("ak@atzean.com", people)).toBeNull();
  });
  it("E06: an imported row with no country is Unknown, not India", () => {
    expect(importRowSchema.parse({ fullName: "Asha Kulkarni", companyName: "Synthetic Co" }).country ?? "Unknown").toBe("Unknown");
  });
  it("normalises a published phone and rejects fragments", () => {
    expect(normalisePhone("+91 (20) 1234-5678")).toBe("+912012345678");
    expect(normalisePhone("12-34")).toBeNull();
  });
});

describe("D05: what counts as a usable existing address", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const days = (n: number) => new Date(now.getTime() - n * 86400000);
  const opts = (over: Partial<Parameters<typeof addressDecision>[1]> = {}) => ({ onCompany: (e: string) => e.endsWith("@acme.example"), isRole: (e: string) => /^(info|sales)@/.test(e), suppressed: new Set<string>(), personSuppressed: false, verifyCacheDays: 30, now, ...over });
  const addr = (value: string, verificationResult: string, over: Partial<ExistingAddress> = {}): ExistingAddress => ({ value, verificationResult, verifiedAt: days(1), optedOutAt: null, bounceCount: 0, status: "UNVERIFIED", ...over });

  it("searches when there is no address, or only a role or off-domain one", () => {
    expect(addressDecision([], opts()).action).toBe("search");
    expect(addressDecision([addr("sales@acme.example", "MAILBOX_CONFIRMED")], opts())).toMatchObject({ action: "search", reason: expect.stringContaining("role address") });
    expect(addressDecision([addr("asha@gmail.com", "MAILBOX_CONFIRMED")], opts())).toMatchObject({ action: "search", reason: expect.stringContaining("off the company's domain") });
  });
  it("replaces a known-invalid or bouncing address", () => {
    expect(addressDecision([addr("asha@acme.example", "INVALID")], opts())).toMatchObject({ action: "search", reason: expect.stringContaining("invalid") });
    expect(addressDecision([addr("asha@acme.example", "UNCHECKED", { bounceCount: 3 })], opts())).toMatchObject({ action: "search", reason: expect.stringContaining("bouncing") });
  });
  it("never looks up a replacement for a suppressed person or address", () => {
    expect(addressDecision([addr("asha@acme.example", "INVALID")], opts({ suppressed: new Set(["asha@acme.example"]) })).action).toBe("blocked");
    expect(addressDecision([addr("asha@acme.example", "INVALID", { optedOutAt: days(2) })], opts()).action).toBe("blocked");
    expect(addressDecision([], opts({ personSuppressed: true })).action).toBe("blocked");
  });
  it("keeps unknown and catch-all apart from invalid: they are checked, not replaced", () => {
    expect(addressDecision([addr("asha@acme.example", "CATCH_ALL")], opts())).toMatchObject({ action: "skip", reason: expect.stringContaining("catch-all") });
    expect(addressDecision([addr("asha@acme.example", "UNKNOWN")], opts())).toMatchObject({ action: "skip", reason: expect.stringContaining("no result") });
    expect(addressDecision([addr("asha@acme.example", "UNCHECKED", { verifiedAt: null })], opts()).action).toBe("skip");
  });
  it("skips a freshly confirmed address and asks for a recheck of a stale one", () => {
    expect(addressDecision([addr("asha@acme.example", "MAILBOX_CONFIRMED")], opts())).toMatchObject({ action: "skip", reason: expect.stringContaining("confirmed") });
    expect(addressDecision([addr("asha@acme.example", "MAILBOX_CONFIRMED", { verifiedAt: days(90) })], opts())).toMatchObject({ action: "recheck" });
  });
  it("prefers the best address when there are several", () => {
    expect(addressDecision([addr("old@acme.example", "INVALID"), addr("asha@acme.example", "MAILBOX_CONFIRMED")], opts()).action).toBe("skip");
  });
});
