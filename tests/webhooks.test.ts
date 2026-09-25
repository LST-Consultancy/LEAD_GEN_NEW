import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, cleanup } from "./helpers/fixtures";
import {
  listWebhooks,
  createWebhook,
  setWebhookActive,
  deleteWebhook,
  testWebhook,
  getWebhookCatalogue,
  WEBHOOK_EVENTS,
} from "@/lib/services/webhooks";
import { ForbiddenError } from "@/lib/auth/context";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Hooks");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("the event catalogue", () => {
  it("describes every event and says which are actually emitted", () => {
    for (const e of WEBHOOK_EVENTS) {
      expect(e.describes.length).toBeGreaterThan(20);
      if (!e.emitted) expect(e.note, `${e.key} must say why not`).toBeTruthy();
    }
  });

  it("says reply events come from a connected mailbox or a reply logged by hand, and which", () => {
    const reply = WEBHOOK_EVENTS.find((e) => e.key === "message.replied")!;
    expect(reply.emitted).toBe(true);
    expect(reply.note).toMatch(/connected mailbox/);
    expect(reply.note).toMatch(/logged on a lead by hand \(loggedByHand: true\)/);
  });

  it("counts emitted against total", () => {
    const c = getWebhookCatalogue();
    // Every declared event now has an emitter (see tests/webhook-events.test.ts).
    expect(c.emittedCount).toBe(c.totalCount);
  });
});

describe("creating a webhook", () => {
  const valid = {
    name: "Ops relay",
    url: "https://hooks.example.com/ops",
    events: ["deal.won", "proposal.accepted"],
  };

  it("returns the signing secret once and keeps it out of the row it returns", async () => {
    const { ctx } = await freshWorkspace();
    const result = await createWebhook(ctx, valid);
    expect(result.secret).toHaveLength(43);
    expect(result.note).toMatch(/not shown again/);
    expect(JSON.stringify(result.webhook)).not.toContain(result.secret);
  });

  it("refuses plain http, because payloads carry lead data", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createWebhook(ctx, { ...valid, url: "http://hooks.example.com/ops" })
    ).rejects.toThrow(/must not travel in the clear/);
  });

  it("refuses an event the app does not emit at all", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createWebhook(ctx, { ...valid, events: ["lead.teleported"] })
    ).rejects.toThrow(/not an event this app emits/);
  });

  it("does not warn when every subscribed event is emitted", async () => {
    const { ctx } = await freshWorkspace();
    const result = await createWebhook(ctx, {
      ...valid,
      events: ["message.replied"],
    });
    expect(result.note).not.toMatch(/not emitted yet/);
  });

  it("refuses a second endpoint on the same URL", async () => {
    const { ctx } = await freshWorkspace();
    await createWebhook(ctx, valid);
    await expect(
      createWebhook(ctx, { ...valid, name: "Duplicate" })
    ).rejects.toThrow(/duplicate deliveries/);
  });

  it("requires at least one event", async () => {
    const { ctx } = await freshWorkspace();
    await expect(createWebhook(ctx, { ...valid, events: [] })).rejects.toThrow();
  });

  it("requires the webhooks permission", async () => {
    const { workspace } = await freshWorkspace();
    const manager = await addMember(workspace.id, "Manager", "manager");
    await expect(createWebhook(manager, valid)).rejects.toThrow(ForbiddenError);
  });
});

describe("listing webhooks", () => {
  it("counts how many of its events are live", async () => {
    const { ctx } = await freshWorkspace();
    await createWebhook(ctx, {
      name: "Mixed",
      url: "https://hooks.example.com/mixed",
      events: ["deal.won", "message.replied"],
    });

    const [hook] = await listWebhooks(ctx);
    expect(hook.events).toHaveLength(2);
    expect(hook.liveEvents).toBe(2);
  });

  it("flags an event that no longer exists in the app", async () => {
    const { ctx } = await freshWorkspace();
    const made = await createWebhook(ctx, {
      name: "Legacy",
      url: "https://hooks.example.com/legacy",
      events: ["deal.won"],
    });
    await db.webhook.update({
      where: { id: made.webhook.id },
      data: { events: ["deal.won", "some.removed.event"] },
    });

    const [hook] = await listWebhooks(ctx);
    expect(hook.events.find((e) => e.key === "some.removed.event")?.known).toBe(false);
  });

  it("never returns the signing secret", async () => {
    const { ctx } = await freshWorkspace();
    const made = await createWebhook(ctx, {
      name: "Secret",
      url: "https://hooks.example.com/secret",
      events: ["deal.won"],
    });
    const listed = await listWebhooks(ctx);
    expect(JSON.stringify(listed)).not.toContain(made.secret);
  });

  it("derives a delivery's outcome rather than storing it", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const made = await createWebhook(ctx, {
      name: "Log",
      url: "https://hooks.example.com/log",
      events: ["deal.won"],
    });
    await db.webhookDelivery.createMany({
      data: [
        {
          workspaceId: workspace.id,
          webhookId: made.webhook.id,
          event: "deal.won",
          payload: {},
          deliveredAt: new Date(),
          statusCode: 200,
        },
        {
          workspaceId: workspace.id,
          webhookId: made.webhook.id,
          event: "deal.won",
          payload: {},
          nextRetryAt: new Date(Date.now() + 60_000),
          error: "503",
        },
        {
          workspaceId: workspace.id,
          webhookId: made.webhook.id,
          event: "deal.won",
          payload: {},
          error: "404 permanent",
        },
      ],
    });

    const [hook] = await listWebhooks(ctx);
    const outcomes = hook.deliveries.map((d) => d.outcome).sort();
    expect(outcomes).toEqual(["delivered", "failed", "retrying"]);
  });

  it("does not leak across workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await createWebhook(b.ctx, {
      name: "Theirs",
      url: "https://hooks.example.com/theirs",
      events: ["deal.won"],
    });
    expect(await listWebhooks(a.ctx)).toHaveLength(0);
    expect(await listWebhooks(b.ctx)).toHaveLength(1);
  });
});

describe("pausing and removing", () => {
  it("says events are dropped while paused, not held", async () => {
    const { ctx } = await freshWorkspace();
    const made = await createWebhook(ctx, {
      name: "Pausable",
      url: "https://hooks.example.com/pausable",
      events: ["deal.won"],
    });
    const result = await setWebhookActive(ctx, made.webhook.id, false);
    expect(result.note).toMatch(/dropped, not held/);
  });

  it("resets the failure count when re-enabled", async () => {
    const { ctx } = await freshWorkspace();
    const made = await createWebhook(ctx, {
      name: "Failing",
      url: "https://hooks.example.com/failing",
      events: ["deal.won"],
    });
    await db.webhook.update({
      where: { id: made.webhook.id },
      data: { failureCount: 9, isActive: false },
    });

    await setWebhookActive(ctx, made.webhook.id, true);
    const after = await db.webhook.findUniqueOrThrow({ where: { id: made.webhook.id } });
    expect(after.failureCount).toBe(0);
  });

  it("keeps the delivery history after removal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const made = await createWebhook(ctx, {
      name: "Doomed",
      url: "https://hooks.example.com/doomed",
      events: ["deal.won"],
    });
    await db.webhookDelivery.create({
      data: {
        workspaceId: workspace.id,
        webhookId: made.webhook.id,
        event: "deal.won",
        payload: {},
        deliveredAt: new Date(),
      },
    });

    const result = await deleteWebhook(ctx, made.webhook.id);
    expect(result.note).toMatch(/history is kept/);
    expect(
      await db.webhookDelivery.count({ where: { webhookId: made.webhook.id } })
    ).toBe(1);
    expect(await listWebhooks(ctx)).toHaveLength(0);
  });

  it("will not touch another workspace's webhook", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const made = await createWebhook(b.ctx, {
      name: "Theirs",
      url: "https://hooks.example.com/theirs2",
      events: ["deal.won"],
    });
    await expect(deleteWebhook(a.ctx, made.webhook.id)).rejects.toThrow(
      /doesn't exist, or you don't have access/
    );
  });
});

describe("test delivery", () => {
  it("records a real delivery row and reports whether it queued", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const made = await createWebhook(ctx, {
      name: "Pingable",
      url: "https://hooks.example.com/ping",
      events: ["deal.won"],
    });

    const result = await testWebhook(ctx, made.webhook.id);
    const delivery = await db.webhookDelivery.findUniqueOrThrow({
      where: { id: result.deliveryId },
    });
    expect(delivery.event).toBe("test.ping");
    expect((delivery.payload as Record<string, unknown>).sentBy).toBe(ctx.user.name);
    void workspace;

    // Whether the queue is up or not, the note tells the truth about it.
    expect(result.note).toMatch(result.queued ? /Test queued/ : /could not be queued/);
  });

  it("tells the receiver to verify the signature exactly as for a real event", async () => {
    const { ctx } = await freshWorkspace();
    const made = await createWebhook(ctx, {
      name: "Sig",
      url: "https://hooks.example.com/sig",
      events: ["deal.won"],
    });
    const result = await testWebhook(ctx, made.webhook.id);
    const delivery = await db.webhookDelivery.findUniqueOrThrow({
      where: { id: result.deliveryId },
    });
    expect((delivery.payload as Record<string, unknown>).note).toMatch(/Verify the signature/);
  });
});
