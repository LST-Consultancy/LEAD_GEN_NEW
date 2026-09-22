import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, cleanup } from "./helpers/fixtures";
import { getRevenueInReach, getRevenueInMotion } from "@/lib/services/today";

let ws: Awaited<ReturnType<typeof makeWorkspace>>;
let stages: { id: string; sortOrder: number }[];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

beforeAll(async () => {
  ws = await makeWorkspace("Motion");

  const pipeline = await db.pipeline.create({
    data: { workspaceId: ws.workspace.id, name: "P", isDefault: true },
  });

  stages = [];
  for (const [i, name] of ["New", "Contacted", "Replied", "Qualified"].entries()) {
    const stage = await db.pipelineStage.create({
      data: {
        workspaceId: ws.workspace.id,
        pipelineId: pipeline.id,
        key: name.toLowerCase(),
        name,
        sortOrder: i,
        probability: (i + 1) * 20,
      },
    });
    stages.push({ id: stage.id, sortOrder: stage.sortOrder });
  }

  const { company } = await makeLead(ws.workspace.id);

  // One deal worth ₹10L that walked three stages inside the window. Naively
  // summing its history rows would report ₹30L of forward movement.
  const walker = await db.deal.create({
    data: {
      workspaceId: ws.workspace.id,
      pipelineId: pipeline.id,
      stageId: stages[3].id,
      companyId: company.id,
      title: "Walker",
      valueInr: 1_000_000,
      createdAt: daysAgo(3),
      stageEnteredAt: daysAgo(1),
    },
  });
  const hops: [number, number, number][] = [
    [0, 1, 3],
    [1, 2, 2],
    [2, 3, 1],
  ];
  for (const [from, to, when] of hops) {
    await db.dealStageHistory.create({
      data: {
        workspaceId: ws.workspace.id,
        dealId: walker.id,
        fromStageId: stages[from].id,
        toStageId: stages[to].id,
        valueAtMove: 1_000_000,
        createdAt: daysAgo(when),
      },
    });
  }

  // One deal worth ₹5L that slipped backwards.
  const slipper = await db.deal.create({
    data: {
      workspaceId: ws.workspace.id,
      pipelineId: pipeline.id,
      stageId: stages[1].id,
      companyId: company.id,
      title: "Slipper",
      valueInr: 500_000,
      createdAt: daysAgo(10),
      stageEnteredAt: daysAgo(2),
    },
  });
  await db.dealStageHistory.create({
    data: {
      workspaceId: ws.workspace.id,
      dealId: slipper.id,
      fromStageId: stages[3].id,
      toStageId: stages[1].id,
      valueAtMove: 500_000,
      createdAt: daysAgo(2),
    },
  });
});

afterAll(async () => {
  await cleanup({
    workspaceIds: [ws.workspace.id],
    userIds: [ws.user.id],
    planIds: [ws.plan.id],
  });
  await db.$disconnect();
});

describe("pipeline movement — counted once per deal", () => {
  it("does not multiply a deal that walked several stages", async () => {
    const r = await getRevenueInReach(ws.ctx);
    // ₹10L once, not ₹30L for three hops.
    expect(r.movedForwardInr).toBe(1_000_000);
    expect(r.movedBackwardInr).toBe(500_000);
  });

  it("never reports more movement than there is pipeline", async () => {
    const r = await getRevenueInReach(ws.ctx);
    const totalDealValue = 1_000_000 + 500_000;
    expect(r.movedForwardInr).toBeLessThanOrEqual(totalDealValue);
    expect(r.movedBackwardInr).toBeLessThanOrEqual(totalDealValue);
  });

  it("counts each moved deal once in the motion breakdown", async () => {
    const m = await getRevenueInMotion(ws.ctx, 7);
    expect(m.advanced.count).toBe(1);
    expect(m.advanced.inr).toBe(1_000_000);
    expect(m.regressed.count).toBe(1);
    expect(m.regressed.inr).toBe(500_000);
  });

  it("reports the net direction, not every intermediate hop", async () => {
    // The walker's three hops net to a single forward move.
    const m = await getRevenueInMotion(ws.ctx, 7);
    expect(m.advanced.count + m.regressed.count).toBe(2);
  });

  it("excludes movement outside the window", async () => {
    const m = await getRevenueInMotion(ws.ctx, 1);
    // Only the final hop (1 day ago) falls inside a one-day window, and it has
    // an origin stage, so it still nets forward — but the slip does not.
    expect(m.regressed.count).toBe(0);
  });
});
