import { describe, expect, it } from "vitest";
import { companyDomain, decide, evidenceLinks, linkedInCompanyUrl, mapCompanyProfile, nameSimilarity, parseSearchItems, safePublicHost, scoreCandidate, searchCandidates } from "@/lib/enrichment/identity";
import { assessAuthor, mapEmployee, rankPeople, roleFocus, searchQueryFor } from "@/lib/enrichment/people";
import { extractEmails, mapWebsiteItems, ownerOf } from "@/lib/enrichment/emails";
import { contactStatusFor, mapChecks } from "@/lib/enrichment/verification";
import { freshStages, runStateOf, type Stage } from "@/lib/enrichment/stages";
import { enrichmentConfigSchema, estimate } from "@/lib/enrichment/config";
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
