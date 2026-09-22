import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RATE_LIMITS,
  __resetRateLimitMemory,
  clientKey,
  rateLimit,
} from "@/lib/security/rate-limit";

/**
 * Stated explicitly rather than inherited from the developer's `.env`: with a
 * REDIS_URL present these would silently exercise the shared path instead.
 */
function withoutRedis() {
  vi.stubEnv("REDIS_URL", "");
}

beforeEach(() => {
  withoutRedis();
  __resetRateLimitMemory();
});

afterEach(() => vi.unstubAllEnvs());

describe("rateLimit, in memory", () => {
  it("allows up to the limit and refuses the next one", async () => {
    const rule = { limit: 3, windowSeconds: 60 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit("login", "a@test", rule));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
  });

  it("counts each key separately", async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    expect((await rateLimit("login", "a@test", rule)).allowed).toBe(true);
    expect((await rateLimit("login", "b@test", rule)).allowed).toBe(true);
    expect((await rateLimit("login", "a@test", rule)).allowed).toBe(false);
  });

  it("counts each rule separately, so one endpoint can't exhaust another", async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    expect((await rateLimit("login", "same", rule)).allowed).toBe(true);
    expect((await rateLimit("spend", "same", rule)).allowed).toBe(true);
  });

  it("resets once the window passes", async () => {
    vi.useFakeTimers();
    try {
      const rule = { limit: 1, windowSeconds: 60 };
      expect((await rateLimit("login", "c@test", rule)).allowed).toBe(true);
      expect((await rateLimit("login", "c@test", rule)).allowed).toBe(false);

      vi.advanceTimersByTime(61_000);
      expect((await rateLimit("login", "c@test", rule)).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the window it is counting in, not a guess", async () => {
    vi.useFakeTimers();
    try {
      const rule = { limit: 5, windowSeconds: 60 };
      await rateLimit("login", "d@test", rule);
      vi.advanceTimersByTime(20_000);
      const second = await rateLimit("login", "d@test", rule);
      expect(second.resetSeconds).toBeLessThanOrEqual(40);
      expect(second.resetSeconds).toBeGreaterThan(38);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says its counting is per-instance when there is no shared store", async () => {
    const result = await rateLimit("login", "e@test");
    // This matters: behind two servers the real limit is double, and a caller
    // that reports the limit as absolute would be lying.
    expect(result.scope).toBe("per-instance");
    expect(result.degraded).toBe(false);
  });

  it("never throws", async () => {
    await expect(rateLimit("write", "")).resolves.toBeTruthy();
  });
});

describe("the rules themselves", () => {
  it("are all positive and bounded", () => {
    for (const [name, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, name).toBeGreaterThan(0);
      expect(rule.windowSeconds, name).toBeGreaterThan(0);
    }
  });

  it("limits sign-in harder than ordinary writes", () => {
    // Password guessing is the attack that matters most here.
    const loginPerSecond = RATE_LIMITS.login.limit / RATE_LIMITS.login.windowSeconds;
    const writePerSecond = RATE_LIMITS.write.limit / RATE_LIMITS.write.windowSeconds;
    expect(loginPerSecond).toBeLessThan(writePerSecond);
  });
});

describe("clientKey", () => {
  it("ignores x-forwarded-for unless a proxy is trusted", () => {
    vi.stubEnv("TRUST_PROXY", "");
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4" });
    // Otherwise an attacker lifts their own limit by inventing an address per
    // request.
    expect(clientKey(headers)).toBe("unknown");
  });

  it("reads the first hop when a proxy is trusted", () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(clientKey(headers)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    vi.stubEnv("TRUST_PROXY", "");
    expect(clientKey(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
  });

  it("returns the fallback when nothing identifies the caller", () => {
    expect(clientKey(new Headers(), "anon")).toBe("anon");
  });
});
