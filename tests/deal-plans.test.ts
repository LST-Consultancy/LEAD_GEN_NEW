import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { createDeal } from "@/lib/services/deal-mutations";
import { addPlanStep, getDealPlan, listDealPlans, movePlanStep, startDealPlan, updatePlanStep, dealsWithoutPlan } from "@/lib/services/deal-plans";
import { STANDARD_PLAN, hasCycle, waitingOn } from "@/lib/plans/template";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

async function setup() {
  const w = await makeWorkspace("Plans");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  const pipeline = await db.pipeline.create({ data: { workspaceId: w.workspace.id, name: "Sales", isDefault: true } });
  await db.pipelineStage.create({ data: { workspaceId: w.workspace.id, pipelineId: pipeline.id, key: "q", name: "Qualified", probability: 20, sortOrder: 0 } });
  const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
  const deal = await createDeal(w.ctx, { leadId: lead.id, valueInr: 500_000 }) as { id: string };
  return { ...w, dealId: deal.id };
}
const step = async (ctx: Parameters<typeof getDealPlan>[0], dealId: string, key: string) => (await getDealPlan(ctx, dealId))!.plan!.steps.find((s) => s.key === key)!;

describe("the template", () => {
  it("has eleven steps whose dependencies all exist and come earlier", () => {
    expect(STANDARD_PLAN.steps).toHaveLength(11);
    const keys = STANDARD_PLAN.steps.map((s) => s.key);
    STANDARD_PLAN.steps.forEach((s, i) => s.dependsOn.forEach((d) => expect(keys.indexOf(d)).toBeLessThan(i)));
    expect(waitingOn({ key: "b", status: "todo", dependsOn: ["a"] }, [{ key: "a", status: "skipped", dependsOn: [] }])).toEqual([]);
  });
});

describe("deal plans", () => {
  it("starts once, with the deal owner on every step", async () => {
    const w = await setup();
    expect((await startDealPlan(w.ctx, w.dealId)).created).toBe(true);
    expect((await startDealPlan(w.ctx, w.dealId)).created).toBe(false);
    const plan = (await getDealPlan(w.ctx, w.dealId))!.plan!;
    expect(plan.steps).toHaveLength(11);
    expect(plan.steps.every((s) => s.owner?.id === w.user.id)).toBe(true);
    expect(await dealsWithoutPlan(w.ctx)).toEqual([]);
  });

  it("refuses to start a step before its dependencies, and a client gate without a recorded approval", async () => {
    const w = await setup(); await startDealPlan(w.ctx, w.dealId);
    const scope = await step(w.ctx, w.dealId, "scope");
    await expect(updatePlanStep(w.ctx, scope.id, { status: "in_progress" })).rejects.toMatchObject({ code: "dependency_open" });
    for (const k of ["discovery", "scope", "proposal", "negotiation"]) await updatePlanStep(w.ctx, (await step(w.ctx, w.dealId, k)).id, { status: "done" });
    const signed = await step(w.ctx, w.dealId, "signed");
    await expect(updatePlanStep(w.ctx, signed.id, { status: "done" })).rejects.toMatchObject({ code: "approval_required" });
    await updatePlanStep(w.ctx, signed.id, { clientApprovedBy: "Asha Kulkarni, CFO" });
    await updatePlanStep(w.ctx, signed.id, { status: "done" });
    const after = await step(w.ctx, w.dealId, "signed");
    expect(after).toMatchObject({ status: "done", clientApprovedBy: "Asha Kulkarni, CFO" });
    // Both kick-off and invoice depend only on "signed", so both are now free.
    expect((await step(w.ctx, w.dealId, "kickoff")).waitingOn).toEqual([]);
    expect((await step(w.ctx, w.dealId, "invoice")).waitingOn).toEqual([]);
    const [row] = await listDealPlans(w.ctx);
    expect(row).toMatchObject({ done: 5, total: 11, next: { title: "Kick-off" } });
  });

  it("owners must be members; a rep cannot see or touch a colleague's plan", async () => {
    const w = await setup(); await startDealPlan(w.ctx, w.dealId);
    const other = await makeWorkspace("PlansOther"); created.workspaceIds.push(other.workspace.id); created.userIds.push(other.user.id); created.planIds.push(other.plan.id);
    const rep = await addMember(w.workspace.id, "PlanRep", "sales_rep"); created.userIds.push(rep.userId);
    const discovery = await step(w.ctx, w.dealId, "discovery");
    await expect(updatePlanStep(w.ctx, discovery.id, { ownerId: other.user.id })).rejects.toMatchObject({ code: "not_a_member" });
    await updatePlanStep(w.ctx, discovery.id, { ownerId: rep.userId });
    expect(await getDealPlan(rep, w.dealId)).toBeNull();
    await expect(updatePlanStep(rep, discovery.id, { status: "done" })).rejects.toMatchObject({ status: 404 });
    await expect(startDealPlan(other.ctx, w.dealId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("editing a plan", () => {
  it("adds a step to a phase, refuses cycles and unknown dependencies, and moves within a phase", async () => {
    const w = await setup(); await startDealPlan(w.ctx, w.dealId);
    const added = await addPlanStep(w.ctx, w.dealId, { phase: "delivery", title: "Data migration dry run", dependsOn: ["kickoff"] });
    let plan = (await getDealPlan(w.ctx, w.dealId))!.plan!;
    const delivery = plan.steps.filter((s) => s.phase === "delivery").map((s) => s.title);
    expect(delivery.at(-1)).toBe("Data migration dry run");
    expect(plan.steps.map((s) => s.order)).toEqual(plan.steps.map((_, i) => i + 1));
    await expect(addPlanStep(w.ctx, w.dealId, { phase: "cash", title: "Bad", dependsOn: ["nope"] })).rejects.toMatchObject({ code: "unknown_dependency" });

    const discovery = plan.steps.find((s) => s.key === "discovery")!;
    await expect(updatePlanStep(w.ctx, discovery.id, { dependsOn: ["review"] })).rejects.toMatchObject({ code: "dependency_cycle" });
    await expect(updatePlanStep(w.ctx, discovery.id, { dependsOn: ["discovery"] })).rejects.toMatchObject({ code: "self_dependency" });
    await updatePlanStep(w.ctx, added.id, { title: "Migration dry run", completionCriteria: "Row counts match" });

    await movePlanStep(w.ctx, added.id, "up");
    plan = (await getDealPlan(w.ctx, w.dealId))!.plan!;
    const d2 = plan.steps.filter((s) => s.phase === "delivery").map((s) => s.title);
    expect(d2.indexOf("Migration dry run")).toBe(d2.length - 2);
    expect((await getDealPlan(w.ctx, w.dealId))!.money).toEqual({ invoicedInr: 0, paidInr: 0, entries: 0 });
  });

  it("detects cycles", () => {
    expect(hasCycle([{ key: "a", dependsOn: ["b"] }, { key: "b", dependsOn: ["a"] }])).toBe(true);
    expect(hasCycle(STANDARD_PLAN.steps.map((s) => ({ key: s.key, dependsOn: [...s.dependsOn] })))).toBe(false);
  });
});
