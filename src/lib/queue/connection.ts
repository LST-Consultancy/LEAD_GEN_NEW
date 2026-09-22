import "server-only";
import IORedis, { type Redis } from "ioredis";

/**
 * Redis connection, shared by the queue producer and the worker.
 *
 * The queue is optional on purpose. With no `REDIS_URL` the app stays fully
 * usable and every queue-backed feature reports itself unavailable, the same
 * way the AI layer does without a provider key — rather than the whole product
 * failing because a piece of background infrastructure is missing.
 */

const globalForRedis = globalThis as unknown as { redis?: Redis | null };

export function isQueueConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export function getRedis(): Redis | null {
  if (!isQueueConfigured()) return null;
  if (globalForRedis.redis !== undefined) return globalForRedis.redis;

  const client = new IORedis(process.env.REDIS_URL!, {
    // BullMQ blocks on reads, so it requires retries to be unlimited.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 500, 5_000),
  });

  client.on("error", (err) => {
    // Logged once per failure rather than thrown: a queue outage must not take
    // request handling down with it.
    console.error("[queue] redis error:", err.message);
  });

  globalForRedis.redis = client;
  return client;
}

/** Liveness check for the job monitor and health endpoint. */
export async function pingQueue(): Promise<
  { ok: true; latencyMs: number } | { ok: false; reason: string }
> {
  if (!isQueueConfigured()) {
    return { ok: false, reason: "REDIS_URL is not set, so no queue is configured." };
  }
  const client = getRedis();
  if (!client) return { ok: false, reason: "Redis client could not be created." };

  const started = Date.now();
  try {
    await client.ping();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
