import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, makeWorkspace, grantPoints, cleanup } from "./helpers/fixtures";
import {
  spendPoints,
  refundPoints,
  getBalance,
  getUsageProjection,
  InsufficientPointsError,
  POINT_COSTS,
} from "@/lib/services/points";

const created: { workspaceIds: string[]; userIds: string[]; planIds: string[] } = {
  workspaceIds: [],
  userIds: [],
  planIds: [],
};

async function freshWorkspace(startingPoints = 100) {
  const w = await makeWorkspace("Points");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  if (startingPoints > 0) await grantPoints(w.workspace.id, startingPoints);
  return w;
}

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("point ledger — immutable and arithmetically sound", () => {
  it("records a spend as a negative delta with the resulting balance", async () => {
    const { ctx, workspace } = await freshWorkspace(100);

    await spendPoints(ctx, {
      type: "REVEAL",
      amount: POINT_COSTS.REVEAL_CONTACT,
      reason: "Revealed a verified contact",
      idempotencyKey: randomUUID(),
    });

    const head = await db.pointLedger.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
    });
    expect(head.delta).toBe(-1);
    expect(head.balanceAfter).toBe(99);
    expect(await getBalance(workspace.id)).toBe(99);
  });

  it("reconstructs the balance from the sum of every delta", async () => {
    const { ctx, workspace } = await freshWorkspace(50);

    for (let i = 0; i < 5; i++) {
      await spendPoints(ctx, {
        type: "RESEARCH",
        amount: POINT_COSTS.DEEP_RESEARCH,
        reason: "Deep research",
        idempotencyKey: randomUUID(),
      });
    }

    const rows = await db.pointLedger.findMany({ where: { workspaceId: workspace.id } });
    const summed = rows.reduce((s, r) => s + r.delta, 0);
    expect(summed).toBe(40);
    expect(await getBalance(workspace.id)).toBe(summed);
  });

  it("refuses a spend larger than the balance and charges nothing", async () => {
    const { ctx, workspace } = await freshWorkspace(3);

    await expect(
      spendPoints(ctx, {
        type: "RESEARCH",
        amount: 10,
        reason: "Too expensive",
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow(InsufficientPointsError);

    // Balance untouched, and no partial row written.
    expect(await getBalance(workspace.id)).toBe(3);
    const spends = await db.pointLedger.count({
      where: { workspaceId: workspace.id, delta: { lt: 0 } },
    });
    expect(spends).toBe(0);
  });

  it("reports what was needed and what was available", async () => {
    const { ctx } = await freshWorkspace(2);
    await expect(
      spendPoints(ctx, {
        type: "RESEARCH",
        amount: 7,
        reason: "x",
        idempotencyKey: randomUUID(),
      })
    ).rejects.toMatchObject({ required: 7, available: 2 });
  });

  it("treats a repeated idempotency key as the same transaction", async () => {
    const { ctx, workspace } = await freshWorkspace(100);
    const key = randomUUID();

    const first = await spendPoints(ctx, {
      type: "REVEAL",
      amount: 1,
      reason: "Reveal",
      idempotencyKey: key,
    });
    const retry = await spendPoints(ctx, {
      type: "REVEAL",
      amount: 1,
      reason: "Reveal",
      idempotencyKey: key,
    });

    expect(retry.id).toBe(first.id);
    expect(await getBalance(workspace.id)).toBe(99);
    const count = await db.pointLedger.count({
      where: { workspaceId: workspace.id, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it("never lets concurrent spends overdraw the balance", async () => {
    const { ctx, workspace } = await freshWorkspace(5);

    // Ten simultaneous 1-point spends against a 5-point balance. At most five
    // may succeed, and the balance must never go negative.
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        spendPoints(ctx, {
          type: "REVEAL",
          amount: 1,
          reason: "Concurrent reveal",
          idempotencyKey: randomUUID(),
        })
      )
    );

    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    const balance = await getBalance(workspace.id);
    const rows = await db.pointLedger.findMany({ where: { workspaceId: workspace.id } });
    const summed = rows.reduce((acc, r) => acc + r.delta, 0);

    expect(succeeded).toBeLessThanOrEqual(5);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(balance).toBe(5 - succeeded);
    // The stored running balance must agree with the sum of every delta, or the
    // ledger is no longer reconstructible.
    expect(summed).toBe(balance);
  });

  it("credits a refund back and records why", async () => {
    const { ctx, workspace } = await freshWorkspace(10);

    await spendPoints(ctx, {
      type: "REVEAL",
      amount: 1,
      reason: "Reveal",
      idempotencyKey: randomUUID(),
    });
    expect(await getBalance(workspace.id)).toBe(9);

    await refundPoints(ctx, {
      amount: 1,
      reason: "Revealed email failed verification, no usable contact returned",
      idempotencyKey: randomUUID(),
    });

    expect(await getBalance(workspace.id)).toBe(10);
    const refund = await db.pointLedger.findFirstOrThrow({
      where: { workspaceId: workspace.id, type: "REFUND" },
    });
    expect(refund.delta).toBe(1);
    expect(refund.reason).toMatch(/failed verification/i);
  });

  it("makes a refund idempotent too", async () => {
    const { ctx, workspace } = await freshWorkspace(10);
    const key = randomUUID();
    await refundPoints(ctx, { amount: 5, reason: "Retry-safe", idempotencyKey: key });
    await refundPoints(ctx, { amount: 5, reason: "Retry-safe", idempotencyKey: key });
    expect(await getBalance(workspace.id)).toBe(15);
  });

  it("keeps ledgers of separate workspaces independent", async () => {
    const a = await freshWorkspace(20);
    const b = await freshWorkspace(20);

    await spendPoints(a.ctx, {
      type: "REVEAL",
      amount: 5,
      reason: "A spends",
      idempotencyKey: randomUUID(),
    });

    expect(await getBalance(a.workspace.id)).toBe(15);
    expect(await getBalance(b.workspace.id)).toBe(20);
  });

  it("projects runway from the trailing 14 days of spend", async () => {
    const { ctx, workspace } = await freshWorkspace(140);

    for (let i = 0; i < 14; i++) {
      await spendPoints(ctx, {
        type: "REVEAL",
        amount: 1,
        reason: "Daily reveal",
        idempotencyKey: randomUUID(),
      });
    }

    const projection = await getUsageProjection(workspace.id);
    expect(projection.balance).toBe(126);
    expect(projection.spentLast14Days).toBe(14);
    expect(projection.averagePerDay).toBe(1);
    expect(projection.daysRemaining).toBe(126);
  });

  it("reports no runway estimate when nothing has been spent", async () => {
    const { workspace } = await freshWorkspace(100);
    const projection = await getUsageProjection(workspace.id);
    expect(projection.spentLast14Days).toBe(0);
    expect(projection.daysRemaining).toBeNull();
  });
});
