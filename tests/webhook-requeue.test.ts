import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, cleanup } from "./helpers/fixtures";
import { createWebhook } from "@/lib/services/webhooks";
import { requeueStrandedDeliveries } from "@/lib/queue/handlers/webhooks";
import { runJob } from "@/lib/queue/router";
import { JOB, JOB_SCHEDULE, MANUAL_TRIGGER } from "@/lib/queue/jobs";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("stranded webhook deliveries", () => {
  it("picks up only never-attempted, older-than-five-minutes deliveries on active hooks", async () => {
    const w = await makeWorkspace("Requeue");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const hook = (await createWebhook(w.ctx, { name: "Requeue relay", url: "https://hooks.example.com/r", events: ["deal.won"] }) as { webhook: { id: string } }).webhook.id;
    const old = new Date(Date.now() - 10 * 60_000);
    const mk = (extra: object) => db.webhookDelivery.create({ data: { workspaceId: w.workspace.id, webhookId: hook, event: "deal.won", payload: {}, createdAt: old, ...extra } });
    await mk({});                                                        // stranded
    await mk({ createdAt: new Date() });                                 // too new
    await mk({ statusCode: 500, error: "Receiver returned 500", attempt: 2 }); // already attempted
    await mk({ deliveredAt: new Date(), statusCode: 200 });              // delivered
    const r = await requeueStrandedDeliveries(w.workspace.id);
    expect(r.stranded).toBe(1);
  });

  it("is a scheduled, manually runnable job wired into the router", async () => {
    expect(JOB_SCHEDULE[JOB.REQUEUE_WEBHOOKS]).toBeTruthy();
    expect(MANUAL_TRIGGER[JOB.REQUEUE_WEBHOOKS].allowed).toBe(true);
    const w = await makeWorkspace("Requeue2");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    await expect(runJob(JOB.REQUEUE_WEBHOOKS, { workspaceId: w.workspace.id })).resolves.toMatchObject({ stranded: 0 });
  });
});
