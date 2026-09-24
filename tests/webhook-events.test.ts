import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, cleanup } from "./helpers/fixtures";
import { createWebhook, setWebhookActive } from "@/lib/services/webhooks";
import { createDeal } from "@/lib/services/deal-mutations";
import { moveDeal } from "@/lib/services/pipeline";
import { logTouch } from "@/lib/services/lead-activity";
import { createBooking } from "@/lib/services/bookings";
import { emitWebhookEvent } from "@/lib/services/webhook-events";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("webhook events are actually emitted", () => {
  it("delivers subscribed events from the real actions, and nothing to unsubscribed or disabled hooks", async () => {
    const w = await makeWorkspace("Hooks");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const pipeline = await db.pipeline.create({ data: { workspaceId: w.workspace.id, name: "Sales", isDefault: true } });
    await db.pipelineStage.create({ data: { workspaceId: w.workspace.id, pipelineId: pipeline.id, key: "q", name: "Qualified", probability: 20, sortOrder: 0 } });
    const won = await db.pipelineStage.create({ data: { workspaceId: w.workspace.id, pipelineId: pipeline.id, key: "won", name: "Won", probability: 100, sortOrder: 1, isWon: true } });

    const sales = await createWebhook(w.ctx, { name: "Sales", url: "https://hooks.example.com/sales", events: ["deal.won", "deal.stage_changed", "message.replied", "meeting.booked"] });
    const other = await createWebhook(w.ctx, { name: "Other", url: "https://hooks.example.com/other", events: ["proposal.viewed"] });
    const off = await createWebhook(w.ctx, { name: "Off", url: "https://hooks.example.com/off", events: ["deal.won"] });
    await setWebhookActive(w.ctx, (off as { webhook: { id: string } }).webhook.id, false);
    const salesId = (sales as { webhook: { id: string } }).webhook.id;
    const otherId = (other as { webhook: { id: string } }).webhook.id;

    const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const deal = await createDeal(w.ctx, { leadId: lead.id, valueInr: 120_000 }) as { id: string };
    await moveDeal(w.ctx, { dealId: deal.id, toStageId: won.id });
    await logTouch(w.ctx, lead.id, { channel: "EMAIL", direction: "INBOUND", outcome: "replied" });
    await createBooking(w.ctx, { title: "Kick-off", leadId: lead.id, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) });

    const events = (await db.webhookDelivery.findMany({ where: { webhookId: salesId }, select: { event: true, payload: true } }));
    expect(events.map((e) => e.event).sort()).toEqual(["deal.stage_changed", "deal.won", "meeting.booked", "message.replied"]);
    expect(events.find((e) => e.event === "deal.won")?.payload).toMatchObject({ dealId: deal.id, toStage: "Won", valueInr: 120_000 });
    expect(events.find((e) => e.event === "message.replied")?.payload).toMatchObject({ loggedByHand: true });
    expect(await db.webhookDelivery.count({ where: { webhookId: otherId } })).toBe(0);
    expect(await db.webhookDelivery.count({ where: { webhook: { workspaceId: w.workspace.id, name: "Off" } } })).toBe(0);
  });

  it("never throws into the caller", async () => {
    await expect(emitWebhookEvent("not-a-uuid", "deal.won", {})).resolves.toBe(0);
  });
});
