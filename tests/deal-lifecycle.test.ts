import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, makeLead, cleanup } from "./helpers/fixtures";
import type { AuthContext } from "@/lib/auth/context";
import { createDeal, deleteDeal, updateDeal } from "@/lib/services/deal-mutations";
import { getPipelineBoard, moveDeal } from "@/lib/services/pipeline";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

let owner: AuthContext; let rep: AuthContext; let otherRep: AuthContext; let manager: AuthContext; let outsider: AuthContext;
let stages: { open: string; next: string; won: string; lost: string };

beforeAll(async () => {
  const w = await makeWorkspace("DealLifecycle"); const o = await makeWorkspace("DealLifecycleOther");
  for (const x of [w, o]) { created.workspaceIds.push(x.workspace.id); created.userIds.push(x.user.id); created.planIds.push(x.plan.id); }
  owner = w.ctx; outsider = o.ctx;
  rep = await addMember(w.workspace.id, "DealRep", "sales_rep");
  otherRep = await addMember(w.workspace.id, "DealRepTwo", "sales_rep");
  manager = await addMember(w.workspace.id, "DealManager", "manager");
  created.userIds.push(rep.userId, otherRep.userId, manager.userId);
  const pipeline = await db.pipeline.create({ data: { workspaceId: w.workspace.id, name: "Sales", isDefault: true } });
  const mk = (key: string, sortOrder: number, extra: object = {}) => db.pipelineStage.create({ data: { workspaceId: w.workspace.id, pipelineId: pipeline.id, key, name: key, probability: 20, sortOrder, ...extra } });
  stages = {
    open: (await mk("qualified", 0)).id,
    next: (await mk("proposal", 1)).id,
    won: (await mk("won", 2, { isWon: true, probability: 100 })).id,
    lost: (await mk("lost", 3, { isLost: true, probability: 0 })).id,
  };
});

async function repDeal(ctx: AuthContext) {
  const { lead } = await makeLead(ctx.workspaceId, { ownerId: ctx.userId });
  const deal = await createDeal(ctx, { leadId: lead.id, valueInr: 250_000 }) as { id: string };
  return deal.id;
}

describe("deal lifecycle", () => {
  it("edits value, close date, next action; moves stage; wins — with one history row per move", async () => {
    const id = await repDeal(rep);
    await updateDeal(rep, id, { valueInr: 400_000, expectedCloseAt: new Date(Date.now() + 20 * 86_400_000), nextActionLabel: "Send revised scope", nextActionAt: new Date(Date.now() + 86_400_000) });
    const edited = await db.deal.findUniqueOrThrow({ where: { id } });
    expect(Number(edited.valueInr)).toBe(400_000);
    expect(edited.nextActionLabel).toBe("Send revised scope");
    expect(await db.auditLog.count({ where: { objectId: id, action: "deal.updated" } })).toBe(1);

    await moveDeal(rep, { dealId: id, toStageId: stages.next });
    await moveDeal(rep, { dealId: id, toStageId: stages.won });
    const won = await db.deal.findUniqueOrThrow({ where: { id } });
    expect(won.status).toBe("WON"); expect(won.wonAt).not.toBeNull(); expect(won.confidence).toBe(100);
    expect(await db.dealStageHistory.count({ where: { dealId: id, fromStageId: { not: null } } })).toBe(2);
    // Moving to the stage it is already in writes no history.
    await moveDeal(rep, { dealId: id, toStageId: stages.won });
    expect(await db.dealStageHistory.count({ where: { dealId: id, fromStageId: { not: null } } })).toBe(2);
  });

  it("refuses a loss without a reason, and records the reason when given", async () => {
    const id = await repDeal(rep);
    await expect(moveDeal(rep, { dealId: id, toStageId: stages.lost })).rejects.toThrow(/lost reason is required/);
    expect((await db.deal.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
    await moveDeal(rep, { dealId: id, toStageId: stages.lost, lostReason: "Chose a competitor" });
    expect(await db.deal.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "LOST", lostReason: "Chose a competitor" });
  });

  it("resolves the close-date flag when the date moves into the future", async () => {
    const id = await repDeal(rep);
    const deal = await db.deal.findUniqueOrThrow({ where: { id } });
    await db.dealRisk.create({ data: { workspaceId: deal.workspaceId, dealId: id, code: "close_date_passed", severity: "medium", title: "Close date passed", explanation: "fixture" } });
    await updateDeal(rep, id, { expectedCloseAt: new Date(Date.now() + 7 * 86_400_000) });
    expect(await db.dealRisk.count({ where: { dealId: id, code: "close_date_passed", resolvedAt: null } })).toBe(0);
  });
});

describe("deal permissions", () => {
  it("a rep cannot see, edit, move or delete a colleague's deal; it reads as not found", async () => {
    const id = await repDeal(otherRep);
    await expect(updateDeal(rep, id, { valueInr: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(moveDeal(rep, { dealId: id, toStageId: stages.next })).rejects.toThrow(/no longer exists/);
    await expect(deleteDeal(rep, id)).rejects.toMatchObject({ status: 404 });
    const board = await getPipelineBoard(rep);
    expect(board?.columns.flatMap((c: { deals: { id: string }[] }) => c.deals).some((d) => d.id === id)).toBe(false);
    const untouched = await db.deal.findUniqueOrThrow({ where: { id } });
    expect(Number(untouched.valueInr)).toBe(250_000); expect(untouched.stageId).toBe(stages.open); expect(untouched.deletedAt).toBeNull();
  });

  it("another workspace cannot reach the deal at all", async () => {
    const id = await repDeal(rep);
    await expect(updateDeal(outsider, id, { valueInr: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(moveDeal(outsider, { dealId: id, toStageId: stages.next })).rejects.toThrow();
  });

  it("only a manager hands a deal to someone else, and only to a member", async () => {
    const id = await repDeal(rep);
    await expect(updateDeal(rep, id, { ownerId: otherRep.userId })).rejects.toMatchObject({ status: 403 });
    await expect(updateDeal(manager, id, { ownerId: outsider.userId })).rejects.toMatchObject({ code: "not_a_member" });
    await updateDeal(manager, id, { ownerId: otherRep.userId });
    expect((await db.deal.findUniqueOrThrow({ where: { id } })).ownerId).toBe(otherRep.userId);
  });

  it("a viewer cannot move or edit", async () => {
    const id = await repDeal(owner);
    const viewer = await addMember(owner.workspaceId, "DealViewer", "viewer"); created.userIds.push(viewer.userId);
    await expect(moveDeal(viewer, { dealId: id, toStageId: stages.next })).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(updateDeal(viewer, id, { valueInr: 1 })).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});
