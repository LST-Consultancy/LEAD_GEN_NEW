import { afterAll, describe, expect, it } from "vitest";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { planAssignments, suggestOwner } from "@/lib/teamcollab/routing";
import { autoAssignPlan, setMemberRouting, teamLoad } from "@/lib/services/team-routing";
import { startDealPlan, updatePlanStep } from "@/lib/services/deal-plans";
import { createDeal } from "@/lib/services/deal-mutations";

const m = (userId: string, skills: string[], openSteps: number, stepCapacity: number | null = 3, isAway = false) => ({ userId, name: userId, skills, openSteps, stepCapacity, isAway });

describe("routing rules", () => {
  it("offers only people with the skill, not away, with room — least loaded first — and says why", () => {
    expect(suggestOwner({ requiredSkill: "NetSuite" }, [m("a", ["netsuite"], 2), m("b", ["netsuite"], 0), m("c", ["qa"], 0)])).toMatchObject({ ownerId: "b" });
    expect(suggestOwner({ requiredSkill: "sap" }, [m("a", ["netsuite"], 0)])).toMatchObject({ ownerId: null, reason: expect.stringContaining("Nobody on the team has the skill") });
    expect(suggestOwner({ requiredSkill: "qa" }, [m("a", ["qa"], 0, 3, true)])).toMatchObject({ ownerId: null, reason: expect.stringContaining("away") });
    expect(suggestOwner({ requiredSkill: null }, [m("a", [], 3, 3)])).toMatchObject({ ownerId: null, reason: expect.stringContaining("at capacity") });
  });
  it("counts each assignment before the next in a batch", () => {
    const r = planAssignments([{ id: "1", title: "A", requiredSkill: null }, { id: "2", title: "B", requiredSkill: null }], [m("a", [], 0, 1), m("b", [], 0, 1)]);
    expect(r.map(x => x.ownerId).sort()).toEqual(["a", "b"]);
  });
});

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("assigning a plan", () => {
  it("assigns unowned steps by skill and capacity, leaves owned ones alone, and records why", async () => {
    const w = await makeWorkspace("Routing"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const company = await db.company.create({ data: { workspaceId: w.workspace.id, name: "Buyer Synthetic", country: "India" } });
    const pipeline = await db.pipeline.create({ data: { workspaceId: w.workspace.id, name: "Sales", isDefault: true } });
    await db.pipelineStage.create({ data: { workspaceId: w.workspace.id, pipelineId: pipeline.id, key: "q", name: "Qualified", probability: 20, sortOrder: 0 } });
    const deal = await createDeal(w.ctx, { companyId: company.id, title: "NetSuite rollout", valueInr: 500_000 }) as { id: string };
    await startDealPlan(w.ctx, deal.id);
    // A plan starts with the deal owner on its steps; clear them to exercise routing.
    await db.dealPlanStep.updateMany({ where: { plan: { dealId: deal.id } }, data: { ownerId: null } });
    const me = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: w.workspace.id, userId: w.user.id } });
    await setMemberRouting(w.ctx, me.id, { skills: ["NetSuite"], stepCapacity: 50, isAway: false });
    expect((await teamLoad(w.ctx))[0]).toMatchObject({ skills: ["netsuite"], stepCapacity: 50 });
    const steps = await db.dealPlanStep.findMany({ where: { plan: { dealId: deal.id } }, orderBy: { order: "asc" } });
    await updatePlanStep(w.ctx, steps[0].id, { requiredSkill: "sap" });
    const preview = await autoAssignPlan(w.ctx, deal.id, { dryRun: true });
    expect(preview.applied).toBe(false);
    expect(await db.dealPlanStep.count({ where: { plan: { dealId: deal.id }, ownerId: { not: null } } })).toBe(0);
    const r = await autoAssignPlan(w.ctx, deal.id);
    expect(r.assignments.find(a => a.stepId === steps[0].id)).toMatchObject({ ownerId: null, reason: expect.stringContaining("sap") });
    expect(await db.dealPlanStep.count({ where: { plan: { dealId: deal.id }, ownerId: w.user.id } })).toBe(steps.length - 1);
  });
});
