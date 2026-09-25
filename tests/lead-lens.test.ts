import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/providers/http", async (original) => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
import { providerJson } from "@/lib/providers/http";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { fakeActors, COMPANY_PAGE } from "./helpers/enrichment-fixture";
import { connectOpportunityProvider } from "@/lib/services/opportunity-providers";
import { confirmLookup, externalLookup } from "@/lib/services/lead-lens";
import { classifyTarget, fromApollo, fromSignalHire } from "@/lib/enrichment/lookup";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });
beforeEach(() => { vi.mocked(providerJson).mockReset(); });
async function workspace() {
  vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
  const w = await makeWorkspace("LeadLens"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  return w;
}
const connect = (w: Awaited<ReturnType<typeof workspace>>, provider: string, apiKey?: string) => connectOpportunityProvider(w.ctx, provider, { ...(apiKey ? { apiKey } : {}), config: {}, allowedSearch: true, allowedStorage: true, allowedEnrichment: true });
const CANDIDATE = { uid: "c".repeat(32), fullName: "Meera Synthetic", headLine: "VP Procurement at Contoso Synthetic", locations: [{ name: "Pune, Maharashtra, India" }], experience: [{ company: "Contoso Synthetic", position: "VP Procurement", current: true, website: "https://contoso-synthetic.example" }], contacts: [{ type: "email", value: "meera@contoso-synthetic.example", subType: "work", rating: 100 }, { type: "email", value: "info@contoso-synthetic.example", subType: "work", rating: 70 }, { type: "email", value: "meera.home@gmail.com", subType: "personal", rating: 100 }] };

describe("reading a lookup target", () => {
  it("accepts a profile, a company page, a domain or a person's full name, and refuses a single word", () => {
    expect(classifyTarget("https://www.linkedin.com/in/meera-synthetic/")).toMatchObject({ kind: "person_linkedin", key: "li:meera-synthetic" });
    expect(classifyTarget("linkedin.com/company/contoso-synthetic")).toMatchObject({ kind: "company_linkedin" });
    expect(classifyTarget("contoso-synthetic.example")).toMatchObject({ kind: "domain", domain: "contoso-synthetic.example" });
    expect(classifyTarget("Meera Synthetic")).toMatchObject({ kind: "person_name", name: "Meera Synthetic", company: null });
    expect(classifyTarget("Meera Synthetic at Contoso Synthetic")).toMatchObject({ kind: "person_name", name: "Meera Synthetic", company: "Contoso Synthetic" });
    expect(classifyTarget("Meera")).toMatchObject({ kind: "unsupported", reason: expect.stringContaining("single word") });
    expect(classifyTarget("R2 D2")).toMatchObject({ kind: "unsupported" });
  });
  it("maps SignalHire and Apollo answers without personal emails, and keeps Apollo's confidence", () => {
    const p = fromSignalHire(CANDIDATE, "https://www.linkedin.com/in/meera-synthetic")!;
    expect(p).toMatchObject({ fullName: "Meera Synthetic", title: "VP Procurement", employer: { name: "Contoso Synthetic", domain: "contoso-synthetic.example" }, match: "exact" });
    expect(p.emails.map(e => e.email)).not.toContain("meera.home@gmail.com");
    expect(fromApollo({ first_name: "A", last_name: "B", email: "email_not_unlocked@domain.com" }, "low", "u")).toMatchObject({ emails: [], match: "low" });
  });
});

describe("external lookup", () => {
  it("says what to connect, records the refusal, and charges nothing", async () => {
    const w = await workspace();
    await expect(externalLookup(w.ctx, { target: "https://www.linkedin.com/in/meera-synthetic" })).rejects.toThrow(/SignalHire or Apollo/);
    expect(await db.externalLookup.findFirstOrThrow({ where: { workspaceId: w.workspace.id } })).toMatchObject({ status: "NOT_CONNECTED" });
    expect(providerJson).not.toHaveBeenCalled();
  });

  it("saves a looked-up profile with only its work email, then serves it from cache without charging", async () => {
    const w = await workspace();
    await connect(w, "signalhire", "sh-key");
    vi.mocked(providerJson).mockResolvedValue([{ item: "x", status: "success", candidate: CANDIDATE }] as never);
    const r = await externalLookup(w.ctx, { target: "linkedin.com/in/meera-synthetic" });
    expect(r).toMatchObject({ status: "FOUND", provider: "signalhire", cached: false, person: { fullName: "Meera Synthetic" } });
    const emails = await db.contactMethod.findMany({ where: { workspaceId: w.workspace.id } });
    expect(emails.map(e => e.value)).toEqual(["meera@contoso-synthetic.example"]);
    expect(r.note).toContain("1 not saved");
    const calls = vi.mocked(providerJson).mock.calls.length;
    expect(await externalLookup(w.ctx, { target: "https://www.linkedin.com/in/meera-synthetic/" })).toMatchObject({ cached: true, status: "FOUND" });
    expect(vi.mocked(providerJson).mock.calls.length).toBe(calls);
  });

  it("holds a low-confidence match for a person to confirm, and keeps other workspaces out of it", async () => {
    const w = await workspace(); const other = await workspace();
    await connect(w, "apollo", "ap-key");
    vi.mocked(providerJson).mockResolvedValue({ person: { id: "ap1", first_name: "Meera", last_name: "Synthetic", title: "Buyer", organization: { name: "Contoso Synthetic", primary_domain: "contoso-synthetic.example" } }, match_confidence: "low" } as never);
    const r = await externalLookup(w.ctx, { target: "https://www.linkedin.com/in/meera-s" });
    expect(r.status).toBe("NEEDS_CONFIRMATION");
    expect(await db.person.count({ where: { workspaceId: w.workspace.id } })).toBe(0);
    await expect(confirmLookup(other.ctx, r.id, { index: 0 })).rejects.toThrow();
    expect(await confirmLookup(w.ctx, r.id, { index: 0 })).toMatchObject({ status: "FOUND" });
    expect(await db.person.count({ where: { workspaceId: w.workspace.id } })).toBe(1);
  });

  it("accepts for a domain only the company page whose own website is that domain", async () => {
    const w = await workspace();
    await connectOpportunityProvider(w.ctx, "linkedin_posts", { apiKey: "apify-test-token", config: {}, allowedSearch: true, allowedStorage: true });
    const other = { ...COMPANY_PAGE, linkedinUrl: "https://www.linkedin.com/company/mentions-it-synthetic/", name: "Mentions It Ltd", website: "https://elsewhere-synthetic.example" };
    const fake = fakeActors({
      "apify/google-search-scraper": () => [{ searchQuery: { term: "q" }, organicResults: [{ title: "Atzean | LinkedIn", url: `${COMPANY_PAGE.linkedinUrl}`, description: "" }, { title: "Mentions", url: other.linkedinUrl, description: "" }] }],
      "harvestapi/linkedin-company": () => [COMPANY_PAGE, other],
    });
    vi.mocked(providerJson).mockImplementation(fake.handler as never);
    const r = await externalLookup(w.ctx, { target: "atzean-synthetic.example" });
    expect(r).toMatchObject({ status: "FOUND", company: { name: "Atzean Technologies LLP", domain: "atzean-synthetic.example" } });
    expect(await db.company.count({ where: { workspaceId: w.workspace.id } })).toBe(1);
  });
});

describe("People Finder evidence filters", () => {
  it("finds post authors, buyer-side and switching companies from stored records only", async () => {
    const { findPeople } = await import("@/lib/services/people");
    const { randomUUID } = await import("node:crypto");
    const w = await workspace();
    const mk = async (name: string, company: string, source: string | null, opp?: { types: ("EXTERNAL_VENDOR" | "MIGRATION" | "INTERNAL_HIRING")[] }) => {
      const c = await db.company.create({ data: { workspaceId: w.workspace.id, name: company, country: "Unknown" } });
      const p = await db.person.create({ data: { workspaceId: w.workspace.id, fullName: name, country: "Unknown" } });
      await db.employment.create({ data: { workspaceId: w.workspace.id, personId: p.id, companyId: c.id, title: "Head of IT", isCurrent: true, association: "current", source } });
      if (opp) await db.opportunity.create({ data: { workspaceId: w.workspace.id, companyId: c.id, title: `${company} request`, service: "ERP", types: opp.types, dedupeKey: randomUUID(), status: "ACTIVE" } });
    };
    await mk("Author Person", "Asks Co", "post_author", { types: ["EXTERNAL_VENDOR"] });
    await mk("Migrating Person", "Moves Co", "apify:harvestapi/linkedin-company-employees", { types: ["MIGRATION"] });
    await mk("Hiring Person", "Hires Co", null, { types: ["INTERNAL_HIRING"] });
    const names = async (f: Record<string, unknown>) => (await findPeople(w.ctx, f)).rows.map(r => r.name).sort();
    expect(await names({ origin: "post_author" })).toEqual(["Author Person"]);
    expect(await names({ buyerSide: true })).toEqual(["Author Person", "Migrating Person"]);
    expect(await names({ switching: true })).toEqual(["Migrating Person"]);
    expect(await names({ origin: "import" })).toEqual(["Hiring Person"]);
    expect(await names({ attachment: "is_lead" })).toEqual([]);
  });
});

describe("searching by a bare name", () => {
  it("lists namesakes from the free searches without charging, then reveals only the one a person chooses, once", async () => {
    const w = await workspace();
    await connect(w, "signalhire", "sh-key"); await connect(w, "apollo", "ap-key");
    const calls: { provider: string; url: string; body?: Record<string, unknown> }[] = [];
    vi.mocked(providerJson).mockImplementation((async (_w: string, provider: string, url: string, _h: unknown, body?: Record<string, unknown>) => {
      calls.push({ provider, url, body });
      if (url.endsWith("/candidate/searchByQuery")) return { total: 2, profiles: [{ uid: "a".repeat(32), fullName: "Meera Synthetic", location: "Mumbai, India", experience: [{ company: "Other Synthetic", title: "Analyst" }] }, { uid: "b".repeat(32), fullName: "Meera Synthetic", location: "Pune, India", experience: [{ company: "Contoso Synthetic", title: "VP Procurement" }] }] };
      if (url.endsWith("/mixed_people/api_search")) return { people: [{ id: "ap-9", first_name: "Meera", last_name_obfuscated: "Sy***c", title: "Designer", organization: { name: "Third Synthetic" } }] };
      if (url.endsWith("/candidate/search")) return [{ item: "b".repeat(32), status: "success", candidate: { ...CANDIDATE, uid: "b".repeat(32), social: [{ type: "li", link: "https://www.linkedin.com/in/meera-synthetic" }] } }];
      throw new Error(`test: unexpected ${url}`);
    }) as never);
    const r = await externalLookup(w.ctx, { target: "Meera Synthetic at Contoso Synthetic" });
    expect(r).toMatchObject({ status: "NEEDS_CONFIRMATION", note: expect.stringContaining("Nothing was charged") });
    const cands = r.candidates as { provider: string; company: string; nameIsPartial: boolean }[];
    // The asked-for company first; Apollo's hidden last name is labelled as such.
    expect(cands[0]).toMatchObject({ provider: "signalhire", company: "Contoso Synthetic" });
    expect(cands.find(c => c.provider === "apollo")).toMatchObject({ nameIsPartial: true });
    // Only free search endpoints were called so far.
    expect(calls.map(c => c.url.split("/").pop())).toEqual(["searchByQuery", "api_search"]);
    expect(await db.person.count({ where: { workspaceId: w.workspace.id } })).toBe(0);
    // Another workspace cannot choose for it.
    const other = await workspace();
    await expect(confirmLookup(other.ctx, r.id, { index: 0 })).rejects.toThrow();
    const saved = await confirmLookup(w.ctx, r.id, { index: 0 });
    expect(saved).toMatchObject({ status: "FOUND", note: expect.stringContaining("one SignalHire credit"), person: { fullName: "Meera Synthetic" } });
    expect(calls.filter(c => c.url.endsWith("/candidate/search"))).toHaveLength(1);
    expect(calls.find(c => c.url.endsWith("/candidate/search"))!.body).toMatchObject({ items: ["b".repeat(32)], withoutWaterfall: true });
    // A second click is refused, not paid for again.
    await expect(confirmLookup(w.ctx, r.id, { index: 0 })).rejects.toThrow(/not waiting/);
    expect(calls.filter(c => c.url.endsWith("/candidate/search"))).toHaveLength(1);
  });
});
