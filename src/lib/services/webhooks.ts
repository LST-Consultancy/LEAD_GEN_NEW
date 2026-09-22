import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate } from "@/lib/services/mutate";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";

/**
 * §66 — outbound events.
 *
 * The catalogue is declared here rather than inferred from whatever strings
 * happen to be in the database, so a receiver can be told exactly what it may
 * subscribe to and what each payload means.
 */

export type WebhookEvent = {
  key: string;
  label: string;
  describes: string;
  /** Whether anything in the app currently emits it. */
  emitted: boolean;
  /** Why not, when nothing does. */
  note?: string;
};

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  {
    key: "lead.created",
    label: "Lead created",
    describes: "A new lead was surfaced, imported or created by hand.",
    emitted: true,
  },
  {
    key: "lead.scored",
    label: "Lead rescored",
    describes: "A lead's score changed enough to move its tier.",
    emitted: true,
  },
  {
    key: "message.replied",
    label: "Reply received",
    describes: "Someone answered an outbound message.",
    emitted: false,
    note: "No mailbox is connected, so no reply can arrive to emit this.",
  },
  {
    key: "deal.stage_changed",
    label: "Deal moved",
    describes: "A deal moved between pipeline stages.",
    emitted: true,
  },
  {
    key: "deal.won",
    label: "Deal won",
    describes: "A deal was marked won, with its value.",
    emitted: true,
  },
  {
    key: "deal.lost",
    label: "Deal lost",
    describes: "A deal was marked lost, with the reason.",
    emitted: true,
  },
  {
    key: "proposal.viewed",
    label: "Proposal viewed",
    describes: "A recipient opened a proposal link. Your own team's views are excluded.",
    emitted: true,
  },
  {
    key: "proposal.accepted",
    label: "Proposal accepted",
    describes: "A recipient accepted a proposal from its link.",
    emitted: true,
  },
  {
    key: "meeting.booked",
    label: "Meeting recorded",
    describes: "A meeting was recorded against a lead.",
    emitted: true,
  },
  {
    key: "agent.action_held",
    label: "Agent action held",
    describes: "An agent produced work that is waiting on a person.",
    emitted: true,
  },
];

export const EVENT_INDEX = new Map(WEBHOOK_EVENTS.map((e) => [e.key, e]));

const webhookSchema = z.object({
  name: z.string().trim().min(2, "Name it so you can tell endpoints apart.").max(80),
  url: z
    .string()
    .trim()
    .url("That is not a valid URL.")
    .max(500)
    .refine((u) => u.startsWith("https://"), {
      message: "Use https. Event payloads carry lead and deal data and must not travel in the clear.",
    }),
  events: z.array(z.string()).min(1, "Subscribe to at least one event.").max(40),
  isActive: z.boolean().default(true),
});

export type WebhookInput = z.input<typeof webhookSchema>;

export async function listWebhooks(ctx: AuthContext) {
  const hooks = await db.webhook.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          event: true,
          statusCode: true,
          attempt: true,
          error: true,
          deliveredAt: true,
          nextRetryAt: true,
          createdAt: true,
        },
      },
      _count: { select: { deliveries: true } },
    },
  });

  return hooks.map((h) => {
    const subscribed = h.events.map((e) => ({
      key: e,
      known: EVENT_INDEX.has(e),
      emitted: EVENT_INDEX.get(e)?.emitted ?? false,
      label: EVENT_INDEX.get(e)?.label ?? e,
    }));

    return {
      id: h.id,
      name: h.name,
      url: h.url,
      events: subscribed,
      /**
       * Whether this endpoint would ever hear anything. Subscribing only to
       * events nothing emits is a silent misconfiguration, so it is named.
       */
      liveEvents: subscribed.filter((e) => e.emitted).length,
      isActive: h.isActive,
      failureCount: h.failureCount,
      lastDeliveryAt: h.lastDeliveryAt?.toISOString() ?? null,
      deliveryCount: h._count.deliveries,
      deliveries: h.deliveries.map((d) => ({
        id: d.id,
        event: d.event,
        statusCode: d.statusCode,
        attempt: d.attempt,
        error: d.error,
        // Derived rather than stored: a delivery is done when it has a
        // delivered time, retrying when it has a next attempt, and failed
        // otherwise. One column fewer to keep consistent.
        outcome: d.deliveredAt
          ? "delivered"
          : d.nextRetryAt
            ? "retrying"
            : d.error
              ? "failed"
              : "pending",
        deliveredAt: d.deliveredAt?.toISOString() ?? null,
        nextRetryAt: d.nextRetryAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      createdAt: h.createdAt.toISOString(),
    };
  });
}

export async function createWebhook(ctx: AuthContext, raw: WebhookInput) {
  const input = webhookSchema.parse(raw);

  const unknown = input.events.filter((e) => !EVENT_INDEX.has(e));
  if (unknown.length > 0) {
    throw new MutationError(
      `${unknown.map((e) => `"${e}"`).join(", ")} ${unknown.length === 1 ? "is not an event" : "are not events"} this app emits.`,
      "unknown_event",
      422
    );
  }

  const clash = await db.webhook.findFirst({
    where: { workspaceId: ctx.workspaceId, url: input.url, deletedAt: null },
    select: { id: true, name: true },
  });
  if (clash) {
    throw new MutationError(
      `"${clash.name}" already posts to that URL. Two endpoints on one URL means duplicate deliveries.`,
      "duplicate_url",
      409
    );
  }

  return mutate(ctx, PERMISSIONS.WEBHOOKS_MANAGE, async () => {
    const secret = randomBytes(32).toString("base64url");
    const hook = await db.webhook.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        url: input.url,
        events: input.events,
        secret,
        isActive: input.isActive,
      },
    });

    const dead = input.events.filter((e) => !EVENT_INDEX.get(e)?.emitted);

    return {
      result: {
        webhook: toPlain({ ...hook, secret: undefined }),
        /** Shown once, like an API key — it is what the receiver verifies with. */
        secret,
        note:
          dead.length > 0
            ? `Created. Copy the signing secret now — it is not shown again. Note that ${dead.map((e) => `"${e}"`).join(", ")} ${dead.length === 1 ? "is" : "are"} not emitted yet, so this endpoint will hear nothing from ${dead.length === 1 ? "it" : "them"}.`
            : "Created. Copy the signing secret now — it is not shown again.",
      },
      log: {
        action: "webhook.created",
        objectType: "Webhook",
        objectId: hook.id,
        after: { name: input.name, url: input.url, events: input.events },
        activity: {
          kind: "webhook.created",
          summary: `Webhook "${input.name}" subscribed to ${input.events.length} ${input.events.length === 1 ? "event" : "events"}`,
        },
      },
    };
  });
}

export async function setWebhookActive(ctx: AuthContext, id: string, isActive: boolean) {
  const hook = await loadScoped(
    () => db.webhook.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That webhook"
  );

  return mutate(ctx, PERMISSIONS.WEBHOOKS_MANAGE, async () => {
    const updated = await db.webhook.update({
      where: { id },
      data: { isActive, ...(isActive ? { failureCount: 0 } : {}) },
    });
    return {
      result: {
        webhook: toPlain({ ...updated, secret: undefined }),
        note: isActive
          ? "Active. Its failure count is reset, so a previously failing endpoint gets a clean start."
          : "Paused. Events are not queued for it while it is off — they are dropped, not held.",
      },
      log: {
        action: isActive ? "webhook.enabled" : "webhook.disabled",
        objectType: "Webhook",
        objectId: id,
        before: { isActive: hook.isActive },
        after: { isActive },
      },
    };
  });
}

export async function deleteWebhook(ctx: AuthContext, id: string) {
  const hook = await loadScoped(
    () => db.webhook.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That webhook"
  );

  return mutate(ctx, PERMISSIONS.WEBHOOKS_MANAGE, async () => {
    await db.webhook.update({ where: { id }, data: { deletedAt: new Date() } });
    return {
      result: { note: "Removed. Its delivery history is kept for the audit trail." },
      log: {
        action: "webhook.deleted",
        objectType: "Webhook",
        objectId: id,
        before: { name: hook.name, url: hook.url },
      },
    };
  });
}

/**
 * Sends a real test delivery.
 *
 * Genuinely attempts the request rather than simulating one, because the point
 * of a test is to find out whether the endpoint is reachable and whether the
 * signature verifies at the other end. A failure here is the useful result.
 */
export async function testWebhook(ctx: AuthContext, id: string) {
  const hook = await loadScoped(
    () => db.webhook.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That webhook"
  );

  return mutate(ctx, PERMISSIONS.WEBHOOKS_MANAGE, async () => {
    const delivery = await db.webhookDelivery.create({
      data: {
        workspaceId: ctx.workspaceId,
        webhookId: hook.id,
        event: "test.ping",
        payload: {
          event: "test.ping",
          workspace: ctx.workspace.slug,
          sentBy: ctx.user.name,
          sentAt: new Date().toISOString(),
          note: "A test delivery. Verify the signature exactly as you would for a real event.",
        } as never,
      },
    });

    const queued = await enqueue(
      JOB.DELIVER_WEBHOOK,
      { workspaceId: ctx.workspaceId, deliveryId: delivery.id },
      { dedupeKey: `webhook-test-${delivery.id}` }
    );

    return {
      result: {
        deliveryId: delivery.id,
        queued: queued.queued,
        note: queued.queued
          ? "Test queued. The result appears in the delivery log below within a few seconds — including the failure, if it fails."
          : `The delivery could not be queued: ${queued.reason}. Nothing was sent.`,
      },
      log: {
        action: "webhook.tested",
        objectType: "Webhook",
        objectId: id,
        after: { deliveryId: delivery.id, queued: queued.queued },
      },
    };
  });
}

/** Everything the Webhooks screen needs to describe the surface honestly. */
export function getWebhookCatalogue() {
  return {
    events: WEBHOOK_EVENTS,
    emittedCount: WEBHOOK_EVENTS.filter((e) => e.emitted).length,
    totalCount: WEBHOOK_EVENTS.length,
  };
}
