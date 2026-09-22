import "server-only";
import { getRedis, isQueueConfigured } from "@/lib/queue/connection";

/**
 * §103 — rate limiting.
 *
 * A fixed window per key, counted in Redis when it is configured and in memory
 * when it is not. Both are real; they differ in what they can promise, and the
 * difference is reported rather than hidden:
 *
 *  - **Redis**: shared across every instance. This is the limit as stated.
 *  - **In memory**: per instance. Behind two servers the effective limit is
 *    double. It is still worth having — it stops a single client hammering one
 *    process — but `scope` says which one answered so a caller can be honest
 *    about it.
 *
 * Fixed window rather than sliding: a sliding window needs either a sorted set
 * per key or a second round trip, and the burst a fixed window allows at a
 * boundary is not the thing that matters for the endpoints this protects.
 *
 * **It never throws.** A Redis outage must not take down sign-in. If the store
 * cannot be reached the request is allowed and `degraded` says so, because
 * failing closed here would turn a cache outage into an outage.
 */

export type RateLimitResult = {
  allowed: boolean;
  /** Requests still available in this window. */
  remaining: number;
  limit: number;
  /** Seconds until the window resets. */
  resetSeconds: number;
  scope: "shared" | "per-instance";
  /** True when the store failed and the request was allowed as a result. */
  degraded: boolean;
};

export type RateLimitRule = {
  /** Requests permitted per window. */
  limit: number;
  windowSeconds: number;
};

/**
 * The rules, named so a route asks for a policy rather than inventing numbers.
 *
 * Each is set from what the endpoint costs and what abusing it achieves, not
 * from a round number.
 */
export const RATE_LIMITS = {
  /** Password guessing. Tight, and keyed on the address being attempted. */
  login: { limit: 8, windowSeconds: 300 },
  /** A public proposal link is a bearer token in a URL; this bounds guessing. */
  publicToken: { limit: 30, windowSeconds: 60 },
  /** Spending points costs the user money, so a runaway loop is expensive. */
  spend: { limit: 30, windowSeconds: 60 },
  /** A model call costs money and takes seconds. */
  ai: { limit: 20, windowSeconds: 60 },
  /** Everything else that writes, as a backstop against a broken client. */
  write: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** In-process counters, used when there is no Redis. */
const memory = new Map<string, { count: number; expiresAt: number }>();

/**
 * Bounded so a long-running process cannot accumulate a key per attacker IP
 * forever. Eviction is oldest-expiry-first, which is the only ordering that
 * cannot evict a live window while a stale one survives.
 */
const MEMORY_MAX_KEYS = 10_000;

export async function rateLimit(
  name: RateLimitName,
  /** What is being limited: an IP, an email, a workspace. Never a secret. */
  key: string,
  rule: RateLimitRule = RATE_LIMITS[name]
): Promise<RateLimitResult> {
  const bucket = `rl:${name}:${key}`;

  if (isQueueConfigured()) {
    const shared = await viaRedis(bucket, rule);
    if (shared) return shared;
    // Redis is configured but unreachable. Fall through to memory rather than
    // refusing every request, and mark it degraded.
    return { ...viaMemory(bucket, rule), degraded: true };
  }

  return viaMemory(bucket, rule);
}

async function viaRedis(bucket: string, rule: RateLimitRule): Promise<RateLimitResult | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    // INCR then EXPIRE only on first write: setting the TTL every time would
    // extend the window on each request and never let it reset.
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, rule.windowSeconds);
    const ttl = await redis.ttl(bucket);

    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      limit: rule.limit,
      // A key with no TTL yet reports the full window rather than -1.
      resetSeconds: ttl >= 0 ? ttl : rule.windowSeconds,
      scope: "shared",
      degraded: false,
    };
  } catch {
    return null;
  }
}

function viaMemory(bucket: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const existing = memory.get(bucket);

  if (!existing || existing.expiresAt <= now) {
    if (memory.size >= MEMORY_MAX_KEYS) evictExpired(now);
    memory.set(bucket, { count: 1, expiresAt: now + rule.windowSeconds * 1000 });
    return {
      allowed: true,
      remaining: rule.limit - 1,
      limit: rule.limit,
      resetSeconds: rule.windowSeconds,
      scope: "per-instance",
      degraded: false,
    };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= rule.limit,
    remaining: Math.max(0, rule.limit - existing.count),
    limit: rule.limit,
    resetSeconds: Math.ceil((existing.expiresAt - now) / 1000),
    scope: "per-instance",
    degraded: false,
  };
}

function evictExpired(now: number) {
  for (const [k, v] of memory) {
    if (v.expiresAt <= now) memory.delete(k);
  }
  // Still full of live windows: drop the ones expiring soonest, since they
  // cost the least to lose.
  if (memory.size >= MEMORY_MAX_KEYS) {
    const byExpiry = [...memory.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [k] of byExpiry.slice(0, Math.ceil(MEMORY_MAX_KEYS / 10))) memory.delete(k);
  }
}

/** Test seam: the in-memory store is process-global and would leak between tests. */
export function __resetRateLimitMemory() {
  memory.clear();
}

/**
 * The client's address, as well as it can be known.
 *
 * `x-forwarded-for` is a client-supplied header and is trivially spoofed unless
 * a proxy you control overwrites it. Only the *first* hop is read, and only
 * when `TRUST_PROXY` says a proxy is in front — otherwise a request can lift
 * its own limit by claiming a new address on every call.
 */
export function clientKey(headers: Headers, fallback = "unknown"): string {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || fallback;
}
