import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";

/**
 * §85 — signed webhook delivery with retries.
 *
 * The signature covers a timestamp as well as the body, so a captured payload
 * cannot be replayed indefinitely. Receivers verify with `verifySignature`
 * below, which is exported so the contract is documented in one place rather
 * than described in prose someone has to reimplement.
 */

const SIGNATURE_VERSION = "v1";
const TIMEOUT_MS = 10_000;

export function signPayload(secret: string, body: string, timestamp: number): string {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestamp}.${body}`);
  return `${SIGNATURE_VERSION}=${mac.digest("hex")}`;
}

/**
 * Reference verifier for receivers. Rejects a signature older than the
 * tolerance so an intercepted request has a short useful life.
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300
): boolean {
  const parts = header.split(",").map((p) => p.trim());
  const timestamp = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  const provided = parts.find((p) => p.startsWith(`${SIGNATURE_VERSION}=`));
  if (!timestamp || !provided) return false;

  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = signPayload(secret, body, timestamp);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Delivers one queued webhook event.
 *
 * Throws on a retryable failure so BullMQ's backoff handles the retry, and
 * returns normally on a permanent failure (4xx) so it is not retried forever
 * against a receiver that will never accept it.
 */
export async function deliverWebhook(workspaceId: string, deliveryId: string) {
  const delivery = await db.webhookDelivery.findFirst({
    where: { id: deliveryId, workspaceId },
    include: { webhook: true },
  });

  if (!delivery) return { deliveryId, skipped: "not_found" as const };
  if (delivery.deliveredAt) return { deliveryId, skipped: "already_delivered" as const };
  if (!delivery.webhook.isActive) {
    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: { error: "Webhook is disabled.", nextRetryAt: null },
    });
    return { deliveryId, skipped: "disabled" as const };
  }

  const body = JSON.stringify({
    id: delivery.id,
    event: delivery.event,
    workspaceId,
    createdAt: delivery.createdAt.toISOString(),
    data: delivery.payload,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `t=${timestamp},${signPayload(delivery.webhook.secret, body, timestamp)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(delivery.webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Signalroom-Webhooks/1",
        "x-signalroom-event": delivery.event,
        "x-signalroom-delivery": delivery.id,
        "x-signalroom-signature": signature,
      },
      body,
      signal: controller.signal,
    });

    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;

    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        statusCode: res.status,
        attempt: delivery.attempt + 1,
        deliveredAt: res.ok ? new Date() : null,
        error: res.ok ? null : `Receiver returned ${res.status}`,
        nextRetryAt: res.ok || permanent ? null : new Date(Date.now() + 60_000),
      },
    });

    await db.webhook.update({
      where: { id: delivery.webhookId },
      data: {
        lastStatus: res.status,
        lastDeliveryAt: new Date(),
        failureCount: res.ok ? 0 : { increment: 1 },
        // A receiver that has rejected 20 in a row is switched off rather than
        // hammered indefinitely.
        ...(delivery.webhook.failureCount + 1 >= 20 && !res.ok ? { isActive: false } : {}),
      },
    });

    if (res.ok) return { deliveryId, status: res.status, delivered: true };

    if (permanent) {
      // Returning rather than throwing stops BullMQ retrying a 4xx.
      return { deliveryId, status: res.status, delivered: false, permanent: true };
    }
    throw new Error(`Receiver returned ${res.status}`);
  } catch (err) {
    const message = controller.signal.aborted
      ? `No response within ${TIMEOUT_MS / 1000}s`
      : (err as Error).message;

    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempt: delivery.attempt + 1,
        error: message,
        nextRetryAt: new Date(Date.now() + 60_000),
      },
    });
    await db.webhook.update({
      where: { id: delivery.webhookId },
      data: { failureCount: { increment: 1 }, lastDeliveryAt: new Date() },
    });
    throw err instanceof Error ? err : new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deliveries recorded but never attempted — created while the queue was down,
 * so no job was ever enqueued for them. Attempted deliveries are left to the
 * job's own retry policy. Safe to repeat: the job id is the delivery id, so a
 * delivery already queued is not queued twice, and delivered ones are skipped.
 */
export async function requeueStrandedDeliveries(workspaceId: string) {
  const now = Date.now();
  const stranded = await db.webhookDelivery.findMany({
    where: {
      workspaceId, deliveredAt: null, statusCode: null, error: null, attempt: 1,
      createdAt: { lt: new Date(now - 5 * 60_000), gt: new Date(now - 7 * 86_400_000) },
      webhook: { isActive: true, deletedAt: null },
    },
    select: { id: true },
    take: 500,
  });
  let queued = 0;
  for (const d of stranded) {
    const r = await enqueue(JOB.DELIVER_WEBHOOK, { workspaceId, deliveryId: d.id }, { dedupeKey: `webhook-${d.id}`, dedupeWindowSec: 0 });
    if (r.queued) queued++;
  }
  return { workspaceId, stranded: stranded.length, queued };
}
