import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { createDeal } from "@/lib/services/deal-mutations";
import { moveDeal } from "@/lib/services/pipeline";
import { getCashSummary, getDealMoney, recordMoney } from "@/lib/services/deal-money";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
const DAY = 86_400_000;

async function wonDeal(value: number) {
  const w = await makeWorkspace("Cash");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  const pipeline = await db.pipeline.create({ data: { workspaceId: w.workspace.id, name: "Sales", isDefault: true } });
  await db.pipelineStage.create({ data: { workspaceId: w.workspace.id, pipelineId: pipeline.id, key: "q", name: "Qualified", probability: 20, sortOrder: 0 } });
  const won = await db.pipelineStage.create({ data: { workspaceId: w.workspace.id, pipelineId: pipeline.id, key: "won", name: "Won", probability: 100, sortOrder: 1, isWon: true } });
  const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
  const deal = await createDeal(w.ctx, { leadId: lead.id, valueInr: value }) as { id: string };
  return { ...w, dealId: deal.id, wonStageId: won.id };
}

describe("cash after the win", () => {
  it("refuses money on a deal that is not won", async () => {
    const w = await wonDeal(100_000);
    await expect(recordMoney(w.ctx, w.dealId, { kind: "invoice", amountInr: 50_000, date: new Date() })).rejects.toMatchObject({ code: "not_won" });
  });

  it("keeps won, invoiced, collected, outstanding and unbilled distinct, in paise", async () => {
    const w = await wonDeal(300_000);
    await moveDeal(w.ctx, { dealId: w.dealId, toStageId: w.wonStageId });
    let m = await getDealMoney(w.ctx, w.dealId);
    expect(m).toMatchObject({ wonInr: 300_000, invoicedInr: 0, paidInr: 0, outstandingInr: 0, unbilledInr: 300_000 });

    await recordMoney(w.ctx, w.dealId, { kind: "invoice", amountInr: 100_000.1, reference: "INV-001", date: new Date(Date.now() - 2 * DAY) });
    await recordMoney(w.ctx, w.dealId, { kind: "payment", amountInr: 40_000.05, reference: "UTR-9", date: new Date() });
    m = await getDealMoney(w.ctx, w.dealId);
    expect(m).toMatchObject({ invoicedInr: 100_000.1, paidInr: 40_000.05, outstandingInr: 60_000.05, unbilledInr: 199_999.9 });

    const cash = await getCashSummary(w.ctx);
    expect(cash).toMatchObject({ wonDeals: 1, collectedInr: 40_000.05, outstandingInr: 60_000.05, overdueDeals: 1 });
  });

  it("refuses an overpayment, a duplicate reference, and an unexplained adjustment", async () => {
    const w = await wonDeal(100_000);
    await moveDeal(w.ctx, { dealId: w.dealId, toStageId: w.wonStageId });
    await recordMoney(w.ctx, w.dealId, { kind: "invoice", amountInr: 50_000, reference: "INV-7", date: new Date() });
    await expect(recordMoney(w.ctx, w.dealId, { kind: "payment", amountInr: 50_000.01, date: new Date() })).rejects.toMatchObject({ code: "overpayment" });
    await expect(recordMoney(w.ctx, w.dealId, { kind: "invoice", amountInr: 10, reference: "INV-7", date: new Date() })).rejects.toMatchObject({ code: "duplicate_reference" });
    await expect(recordMoney(w.ctx, w.dealId, { kind: "adjustment", amountInr: -1000, date: new Date() })).rejects.toThrow(/Say why/);
    await recordMoney(w.ctx, w.dealId, { kind: "payment", amountInr: 50_000, date: new Date() });
    await expect(recordMoney(w.ctx, w.dealId, { kind: "adjustment", amountInr: -1000, note: "Discount agreed", date: new Date() })).rejects.toMatchObject({ code: "below_paid" });
    expect(await db.moneyEntry.count({ where: { dealId: w.dealId } })).toBe(2);
  });

  it("is invisible to a rep who does not own the deal", async () => {
    const w = await wonDeal(100_000);
    const rep = await addMember(w.workspace.id, "CashRep", "sales_rep"); created.userIds.push(rep.userId);
    await expect(getDealMoney(rep, w.dealId)).rejects.toMatchObject({ status: 404 });
    expect((await getCashSummary(rep)).wonDeals).toBe(0);
  });
});
