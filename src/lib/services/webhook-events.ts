import "server-only";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";
import { log } from "@/lib/observability/log";

export type EmittedEvent =
  | "lead.created" | "lead.scored" | "message.replied" | "deal.stage_changed" | "deal.won" | "deal.lost"
  | "proposal.viewed" | "proposal.accepted" | "meeting.booked" | "agent.action_held";

/**
 * Sends an event to every active webhook in the workspace subscribed to it.
 *
 * Until this existed the catalogue said eight events were "emitted" and none
 * was: only the test button ever created a delivery. Each subscriber gets its
 * own delivery row, then the existing signed, retried delivery job sends it.
 *
 * Never throws. A webhook is a side effect of the user's action, and a broken
 * endpoint or a queue outage must not fail that action. A delivery that could
 * not be queued stays in the log unsent, which the webhook screen shows.
 */
export async function emitWebhookEvent(workspaceId: string, event: EmittedEvent, data: Record<string, unknown>): Promise<number> {
  try {
    const hooks = await db.webhook.findMany({ where: { workspaceId, isActive: true, deletedAt: null, events: { has: event } }, select: { id: true } });
    let queued = 0;
    for (const hook of hooks) {
      const delivery = await db.webhookDelivery.create({ data: { workspaceId, webhookId: hook.id, event, payload: data as never } });
      const r = await enqueue(JOB.DELIVER_WEBHOOK, { workspaceId, deliveryId: delivery.id }, { dedupeKey: `webhook-${delivery.id}`, dedupeWindowSec: 0 });
      if (r.queued) queued++;
    }
    return queued;
  } catch (err) {
    log.queue.warn("webhook event not emitted", { event, workspaceId, err });
    return 0;
  }
}
