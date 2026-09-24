import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/providers/http", async (original) => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
import { providerJson } from "@/lib/providers/http";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { ingestOpportunity } from "@/lib/services/opportunity-ingestion";
import { enrichOpportunity, opportunityToCrm } from "@/lib/services/opportunity-actions";
import { connectOpportunityProvider } from "@/lib/services/opportunity-providers";
import { parseOpportunityQuery } from "@/lib/opportunities/query-parser";
import { titleAuthority } from "@/lib/opportunities/authority";
import type { SourceDocument } from "@/lib/opportunities/extractor";
import { getSourceAttribution } from "@/lib/services/analytics";

const criteria = parseOpportunityQuery("NetSuite implementation");
const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });
beforeEach(() => vi.mocked(providerJson).mockReset());

async function setup() {
  vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
  const w = await makeWorkspace("ConvertFixture");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  const search = await db.opportunitySearch.create({ data: { workspaceId: w.workspace.id, createdById: w.user.id, query: "NetSuite implementation", criteria, providers: ["brave"], idempotencyKey: randomUUID() } });
  const doc: SourceDocument = { provider: "brave", kind: "PUBLIC_WEB", externalId: `https://buyer-${randomUUID().slice(0, 6)}.invalid/rfp`, sourceUrl: `https://buyer.invalid/rfp/${randomUUID()}`, title: "Request for Proposal: NetSuite implementation", description: "Fixture Buyer is looking for a NetSuite implementation partner and invites proposals.", company: { name: "Fixture Buyer", domain: "fixture-buyer.invalid" }, postedAt: null, rawSourceReference: {}, status: "OPEN" };
  const opp = await ingestOpportunity(w.workspace.id, search.id, doc, criteria, { allowedExport: false, retentionDays: 30 });
  await connectOpportunityProvider(w.ctx, "hunter", { apiKey: "hunter-test-key", config: {}, allowedSearch: true, allowedStorage: true, allowedEnrichment: true });
  return { w, opportunityId: opp!.id };
}
const hunterReply = (emails: { value: string; first_name: string; last_name: string; position: string; confidence: number }[]) => ({ data: { emails: emails.map(e => ({ ...e, sources: [] })) } });

describe("title authority", () => {
  it("marks only budget-holding ranks as likely decision makers", () => {
    expect(titleAuthority("Chief Technology Officer").likelyDecisionMaker).toBe(true);
    expect(titleAuthority("VP Finance").likelyDecisionMaker).toBe(true);
    expect(titleAuthority("Procurement Analyst")).toMatchObject({ likelyDecisionMaker: false, relevant: true });
    expect(titleAuthority("NetSuite Administrator")).toMatchObject({ likelyDecisionMaker: false, relevant: true });
    expect(titleAuthority("Head of IT")).toMatchObject({ seniority: "head", likelyDecisionMaker: false });
  });
});

describe("enrichment identity", () => {
  it("keeps one person with two addresses, and does not promote an analyst to decision maker", async () => {
    const { w, opportunityId } = await setup();
    vi.mocked(providerJson).mockResolvedValue(hunterReply([
      { value: "asha@fixture-buyer.invalid", first_name: "Asha", last_name: "Rao", position: "CFO", confidence: 91 },
      { value: "asha.rao@fixture-buyer.invalid", first_name: "Asha", last_name: "Rao", position: "CFO", confidence: 80 },
      { value: "ravi@fixture-buyer.invalid", first_name: "Ravi", last_name: "Iyer", position: "Procurement Analyst", confidence: 70 },
    ]));
    await enrichOpportunity(w.ctx, opportunityId);
    const people = await db.person.findMany({ where: { workspaceId: w.workspace.id }, include: { contactMethods: true, employments: true } });
    expect(people).toHaveLength(2);
    const asha = people.find(p => p.fullName === "Asha Rao")!;
    expect(asha.contactMethods).toHaveLength(2);
    expect(asha.employments[0].isDecisionMaker).toBe(true);
    expect(people.find(p => p.fullName === "Ravi Iyer")!.employments[0]).toMatchObject({ isDecisionMaker: false, seniority: "individual" });

    // Repeating enrichment adds nothing.
    await enrichOpportunity(w.ctx, opportunityId);
    expect(await db.contactMethod.count({ where: { workspaceId: w.workspace.id } })).toBe(3);
  });

  it("stores the verifier's result beside discovery confidence, not over it", async () => {
    const { w, opportunityId } = await setup();
    vi.mocked(providerJson).mockResolvedValueOnce(hunterReply([{ value: "cto@fixture-buyer.invalid", first_name: "Meera", last_name: "Nair", position: "CTO", confidence: 88 }]));
    await enrichOpportunity(w.ctx, opportunityId);
    vi.mocked(providerJson).mockResolvedValueOnce({ data: { status: "invalid", score: 12, disposable: false, accept_all: false } });
    await enrichOpportunity(w.ctx, opportunityId, true);
    const contact = await db.contactMethod.findFirstOrThrow({ where: { workspaceId: w.workspace.id } });
    expect(contact).toMatchObject({ confidence: 88, verificationResult: "INVALID", status: "FAILED" });
    expect((contact.provenance as { verification?: { status: string } }).verification?.status).toBe("INVALID");
  });
});

describe("opportunity to lead", () => {
  async function withPerson() {
    const s = await setup();
    vi.mocked(providerJson).mockResolvedValue(hunterReply([
      { value: "cfo@fixture-buyer.invalid", first_name: "Asha", last_name: "Rao", position: "CFO", confidence: 91 },
      { value: "it@fixture-buyer.invalid", first_name: "Karan", last_name: "Shah", position: "IT Manager", confidence: 75 },
    ]));
    await enrichOpportunity(s.w.ctx, s.opportunityId);
    const people = await db.person.findMany({ where: { workspaceId: s.w.workspace.id }, orderBy: { fullName: "asc" } });
    return { ...s, people };
  }

  it("requires a chosen person who is at the company", async () => {
    const { w, opportunityId } = await withPerson();
    await expect(opportunityToCrm(w.ctx, opportunityId, {})).rejects.toThrow();
    await expect(opportunityToCrm(w.ctx, opportunityId, { personId: randomUUID() })).rejects.toMatchObject({ code: "person_not_at_company" });
  });

  it("creates the lead for the chosen person with the opportunity's evidence, and repeats harmlessly", async () => {
    const { w, opportunityId, people } = await withPerson();
    const karan = people.find(p => p.fullName === "Karan Shah")!;
    const first = await opportunityToCrm(w.ctx, opportunityId, { personId: karan.id });
    expect(first).toMatchObject({ created: true, signals: 1, scored: false });
    expect(first.note).toMatch(/define a primary ICP/);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: first.leadId }, include: { signals: true } });
    expect(lead.personId).toBe(karan.id);
    expect(lead.signals[0]).toMatchObject({ type: "ANNOUNCEMENT", sourceKind: "PUBLIC_WEB", sourceName: "brave" });

    const again = await opportunityToCrm(w.ctx, opportunityId, { personId: karan.id });
    expect(again).toMatchObject({ leadId: first.leadId, created: false, signals: 0 });
    expect(await db.signal.count({ where: { leadId: first.leadId } })).toBe(1);
    const attribution = await getSourceAttribution(w.ctx);
    expect(JSON.stringify(attribution)).toMatch(/PUBLIC_WEB/);
  });

  it("scores the lead against the primary ICP when one exists", async () => {
    const { w, opportunityId, people } = await withPerson();
    await db.icpProfile.create({ data: { workspaceId: w.workspace.id, name: "Fixture ICP", isPrimary: true, industries: [], locations: [], buyerRoles: ["CFO"], seniorities: [], technologies: ["NetSuite"], triggerEvents: [], exclusions: [], pains: [] } });
    const result = await opportunityToCrm(w.ctx, opportunityId, { personId: people[0].id });
    expect(result.scored).toBe(true);
    expect(await db.leadScore.findUnique({ where: { leadId: result.leadId } })).not.toBeNull();
  });

  it("does not convert another workspace's opportunity", async () => {
    const { opportunityId, people } = await withPerson();
    const other = await makeWorkspace("ConvertOther");
    created.workspaceIds.push(other.workspace.id); created.userIds.push(other.user.id); created.planIds.push(other.plan.id);
    await expect(opportunityToCrm(other.ctx, opportunityId, { personId: people[0].id })).rejects.toMatchObject({ status: 404 });
  });
});
