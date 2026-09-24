import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { createDeal } from "@/lib/services/deal-mutations";
import { addPlanStep, deletePlanTemplate, getDealPlan, listPlanTemplates, savePlanAsTemplate, startDealPlan, updatePlanStep } from "@/lib/services/deal-plans";
import { restoreFromBin } from "@/lib/services/recycle-bin";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

async function setup() {
  const w = await makeWorkspace("Templates");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  const pipeline = await db.pipeline.create({ data: { workspaceId: w.workspace.id, name: "Sales", isDefault: true } });
  await db.pipelineStage.create({ data: { workspaceId: w.workspace.id, pipelineId: pipeline.id, key: "q", name: "Qualified", probability: 20, sortOrder: 0 } });
  const deal = async () => { const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id }); return (await createDeal(w.ctx, { leadId: lead.id, valueInr: 100_000 }) as { id: string }).id; };
  return { ...w, deal };
}

describe("plan templates", () => {
  it("saves a plan's steps without skipped ones, versions by name, and starts new plans from it", async () => {
    const w = await setup();
    const a = await w.deal(); await startDealPlan(w.ctx, a);
    await addPlanStep(w.ctx, a, { phase: "delivery", title: "Data migration dry run", dependsOn: ["kickoff"] });
    const review = (await getDealPlan(w.ctx, a))!.plan!.steps.find((s) => s.key === "review")!;
    await updatePlanStep(w.ctx, review.id, { status: "skipped" });

    const v1 = await savePlanAsTemplate(w.ctx, a, "NetSuite implementation");
    expect(v1).toMatchObject({ version: 1, steps: 11 });   // 11 standard + 1 added − 1 skipped
    const v2 = await savePlanAsTemplate(w.ctx, a, "netsuite implementation");
    expect(v2).toMatchObject({ name: "NetSuite implementation", version: 2 });
    expect(await listPlanTemplates(w.ctx)).toEqual([expect.objectContaining({ id: v2.id, version: 2 })]);

    const b = await w.deal(); await startDealPlan(w.ctx, b, v2.id);
    const planB = (await getDealPlan(w.ctx, b))!.plan!;
    expect(planB.template).toBe("NetSuite implementation v2");
    expect(planB.steps.map((s) => s.title)).toContain("Data migration dry run");
    expect(planB.steps.map((s) => s.key)).not.toContain("review");

    await deletePlanTemplate(w.ctx, v2.id);
    expect(await listPlanTemplates(w.ctx)).toEqual([]);
    expect((await getDealPlan(w.ctx, b))!.plan!.steps).toHaveLength(11);   // existing plan untouched
    const entry = await db.deletedRecord.findFirstOrThrow({ where: { workspaceId: w.workspace.id, objectType: "PlanTemplate" } });
    await restoreFromBin(w.ctx, entry.id);
    expect((await listPlanTemplates(w.ctx)).map((t) => t.version)).toEqual([2]);
  });

  it("needs pipeline.configure to save, and cannot use another workspace's template", async () => {
    const w = await setup(); const other = await setup();
    const rep = await addMember(w.workspace.id, "TplRep", "sales_rep"); created.userIds.push(rep.userId);
    const { lead } = await makeLead(w.workspace.id, { ownerId: rep.userId });
    const repDeal = (await createDeal(rep, { leadId: lead.id, valueInr: 1000 }) as { id: string }).id;
    await startDealPlan(rep, repDeal);
    await expect(savePlanAsTemplate(rep, repDeal, "Rep template")).rejects.toMatchObject({ name: "ForbiddenError" });
    const od = await other.deal(); await startDealPlan(other.ctx, od);
    const foreign = await savePlanAsTemplate(other.ctx, od, "Theirs");
    await expect(startDealPlan(w.ctx, await w.deal(), foreign.id)).rejects.toMatchObject({ status: 404 });
  });
});
