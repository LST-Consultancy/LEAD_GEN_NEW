import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import type { AuthContext } from "@/lib/auth/context";
import { createProposal, deleteProposal, proposalStartingPoint, recordProposalDecision, sendProposal, updateProposal, type ProposalInput } from "@/lib/services/proposals";
import { createDeal } from "@/lib/services/deal-mutations";
import { computeTotals } from "@/lib/proposals/money";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

async function workspace() {
  const w = await makeWorkspace("Authoring");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  const pipeline = await db.pipeline.create({ data: { workspaceId: w.workspace.id, name: "Sales", isDefault: true } });
  await db.pipelineStage.create({ data: { workspaceId: w.workspace.id, pipelineId: pipeline.id, key: "q", name: "Qualified", probability: 20, sortOrder: 0 } });
  return w;
}
const body = (companyId: string, over: Partial<ProposalInput> = {}): ProposalInput => ({
  title: "Phase one", companyId, taxRate: 18, sections: [], items: [{ name: "Build", quantity: 3, unit: "sprint", unitPriceInr: 123_456.78 }], ...over,
});
const dealFor = async (ctx: AuthContext, leadId: string) => (await createDeal(ctx, { leadId, valueInr: 100_000 }) as { id: string }).id;

describe("proposal links", () => {
  it("refuses a deal from another workspace, on create and on update", async () => {
    const w = await workspace(); const other = await workspace();
    const mine = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const theirs = await makeLead(other.workspace.id, { ownerId: other.user.id });
    const foreignDeal = await dealFor(other.ctx, theirs.lead.id);
    await expect(createProposal(w.ctx, body(mine.company.id, { dealId: foreignDeal }))).rejects.toMatchObject({ status: 404 });
    const { proposal } = await createProposal(w.ctx, body(mine.company.id));
    await expect(updateProposal(w.ctx, proposal.id, body(mine.company.id, { dealId: foreignDeal }))).rejects.toMatchObject({ status: 404 });
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).dealId).toBeNull();
  });

  it("refuses a lead or deal at a different company", async () => {
    const w = await workspace();
    const a = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const b = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const bDeal = await dealFor(w.ctx, b.lead.id);
    await expect(createProposal(w.ctx, body(a.company.id, { leadId: b.lead.id }))).rejects.toMatchObject({ code: "lead_company_mismatch" });
    await expect(createProposal(w.ctx, body(a.company.id, { dealId: bDeal }))).rejects.toMatchObject({ code: "deal_company_mismatch" });
    const aDeal = await dealFor(w.ctx, a.lead.id);
    const { proposal } = await createProposal(w.ctx, body(a.company.id, { leadId: a.lead.id, dealId: aDeal }));
    expect(proposal.dealId).toBe(aDeal);
  });

  it("does not let a rep attach a colleague's deal", async () => {
    const w = await workspace();
    const rep = await addMember(w.workspace.id, "AuthRep", "sales_rep"); created.userIds.push(rep.userId);
    const lead = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const ownersDeal = await dealFor(w.ctx, lead.lead.id);
    await expect(createProposal(rep, body(lead.company.id, { dealId: ownersDeal }))).rejects.toMatchObject({ status: 404 });
  });
});

describe("starting a proposal", () => {
  it("starts from a lead with its company, visible leads and open deals", async () => {
    const w = await workspace();
    const { lead, company } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const deal = await dealFor(w.ctx, lead.id);
    const start = await proposalStartingPoint(w.ctx, { leadId: lead.id });
    expect(start?.company?.id).toBe(company.id);
    expect(start?.leads.map((l: { id: string }) => l.id)).toContain(lead.id);
    expect(start?.deals.map((d: { id: string }) => d.id)).toEqual([deal]);
  });

  it("returns nothing for a lead the caller cannot see", async () => {
    const w = await workspace(); const other = await workspace();
    const rep = await addMember(w.workspace.id, "AuthRep2", "sales_rep"); created.userIds.push(rep.userId);
    const ownersLead = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const foreign = await makeLead(other.workspace.id);
    expect(await proposalStartingPoint(rep, { leadId: ownersLead.lead.id })).toBeNull();
    expect(await proposalStartingPoint(w.ctx, { leadId: foreign.lead.id })).toBeNull();
    expect(await proposalStartingPoint(w.ctx, { companyId: foreign.company.id })).toBeNull();
  });
});

describe("lifecycle through the editor's calls", () => {
  it("draft → edit → make live (no email) → accepted, which then cannot be edited or deleted", async () => {
    const w = await workspace();
    const { company } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const { proposal } = await createProposal(w.ctx, body(company.id));
    expect(proposal.state).toBe("DRAFT");
    const items = [{ name: "Build", quantity: 3, unit: "sprint", unitPriceInr: 123_456.78 }, { name: "Support", quantity: 12, unit: "month", unitPriceInr: 9_999.99 }];
    await updateProposal(w.ctx, proposal.id, body(company.id, { items, taxRate: 18 }));
    const saved = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    const expected = computeTotals(items, 18);
    expect(Number(saved.totalInr)).toBe(expected.totalInr);
    expect(Number(saved.subtotalInr)).toBe(expected.subtotalInr);

    const live = await sendProposal(w.ctx, proposal.id);
    expect(live.note).toMatch(/Nothing was emailed/);
    expect(await db.message.count({ where: { workspaceId: w.workspace.id } })).toBe(0);

    await recordProposalDecision(w.ctx, proposal.id, { decision: "accept" });
    await expect(updateProposal(w.ctx, proposal.id, body(company.id))).rejects.toMatchObject({ code: "accepted_immutable" });
    await expect(deleteProposal(w.ctx, proposal.id)).rejects.toMatchObject({ code: "accepted_immutable" });
  });
});
