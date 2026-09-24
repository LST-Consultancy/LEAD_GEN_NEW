import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { makeWorkspace, addMember, makeLead, cleanup, db } from "./helpers/fixtures";
import { getAccount } from "@/lib/services/people";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
async function workspace() {
  const w = await makeWorkspace("AccountFixture");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  return w;
}
async function deal(workspaceId: string, companyId: string, ownerId: string, title: string) {
  const pipeline = await db.pipeline.findFirst({ where: { workspaceId } }) ?? await db.pipeline.create({ data: { workspaceId, name: "P", isDefault: true } });
  const stage = await db.pipelineStage.findFirst({ where: { pipelineId: pipeline.id } }) ?? await db.pipelineStage.create({ data: { workspaceId, pipelineId: pipeline.id, key: "new", name: "New", probability: 5, sortOrder: 0 } });
  return db.deal.create({ data: { workspaceId, pipelineId: pipeline.id, stageId: stage.id, companyId, ownerId, title, valueInr: 100000, status: "OPEN", confidence: 5, stageEnteredAt: new Date(), lastActivityAt: new Date() } });
}
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("account detail", () => {
  it("opens an account in the workspace and treats other workspaces and bad ids as not found", async () => {
    const a = await workspace(); const b = await workspace();
    const { company } = await makeLead(a.workspace.id, { companyName: "Fixture Account Co" });
    expect((await getAccount(a.ctx, company.id))?.name).toBe("Fixture Account Co");
    expect(await getAccount(b.ctx, company.id)).toBeNull();
    expect(await getAccount(a.ctx, randomUUID())).toBeNull();
    expect(await getAccount(a.ctx, "not-a-uuid")).toBeNull();
  });

  it("shows a sales rep only their own deals and leads, as the pipeline does", async () => {
    const w = await workspace();
    const rep = await addMember(w.workspace.id, "AccountRep", "sales_rep");
    created.userIds.push(rep.userId);
    const { company } = await makeLead(w.workspace.id, { ownerId: w.user.id, name: "Owner Lead" });
    await db.lead.create({ data: { workspaceId: w.workspace.id, personId: (await db.person.create({ data: { workspaceId: w.workspace.id, fullName: "Rep Lead" } })).id, companyId: company.id, ownerId: rep.userId, surfacedReason: "fixture" } });
    await deal(w.workspace.id, company.id, w.user.id, "Owner deal");
    await deal(w.workspace.id, company.id, rep.userId, "Rep deal");

    const asOwner = await getAccount(w.ctx, company.id);
    expect(asOwner?.openDeals.map((d) => d.title).sort()).toEqual(["Owner deal", "Rep deal"]);
    const asRep = await getAccount(rep, company.id);
    expect(asRep?.openDeals.map((d) => d.title)).toEqual(["Rep deal"]);
    expect(asRep?.leads.map((l) => l.name)).toEqual(["Rep Lead"]);
  });
});
