import { afterAll, describe, expect, it } from "vitest";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { claimLead, listClaimable } from "@/lib/services/lead-claims";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("the claim queue", () => {
  it("offers unowned leads without contact details, and a claim is atomic and scoped", async () => {
    const w = await makeWorkspace("Claims", "sales_rep"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const other = await makeWorkspace("ClaimsOther"); created.workspaceIds.push(other.workspace.id); created.userIds.push(other.user.id); created.planIds.push(other.plan.id);
    const company = await db.company.create({ data: { workspaceId: w.workspace.id, name: "Buyer Synthetic", country: "India" } });
    const person = await db.person.create({ data: { workspaceId: w.workspace.id, fullName: "Meera Synthetic", country: "India" } });
    const lead = await db.lead.create({ data: { workspaceId: w.workspace.id, companyId: company.id, personId: person.id, ownerId: null, surfacedReason: "Asked for an ERP partner" } });
    const q = await listClaimable(w.ctx);
    expect(q.total).toBe(1);
    expect(JSON.stringify(q)).not.toMatch(/contactMethods|@/);
    await expect(claimLead(other.ctx, lead.id)).rejects.toThrow(/not found/);
    expect(await claimLead(w.ctx, lead.id)).toMatchObject({ ownerId: w.user.id });
    await expect(claimLead(w.ctx, lead.id)).rejects.toThrow(/claimed this lead a moment ago/);
    expect((await listClaimable(w.ctx)).total).toBe(0);
  });
});
