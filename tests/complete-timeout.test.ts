import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "@/lib/ai/complete";

/**
 * `complete()` promises two things the rest of the app relies on: it never
 * throws, and it returns within its budget. The second one was not true.
 *
 * Aborting a `fetch` signals intent; it does not guarantee the promise settles.
 * Measured against the real provider, a request aborted at 25 seconds only
 * rejected after 603 — so a page awaiting a draft hung for ten minutes while
 * every caller had been told the call was bounded.
 *
 * These pin the bound itself rather than the abort.
 */

const ctx = { workspaceId: "00000000-0000-0000-0000-000000000000", userId: null };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A provider that accepts the abort signal and then ignores it entirely. */
function hangingProvider() {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("AI_DEFAULT_PROVIDER", "anthropic");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {}))
  );
}

describe("complete() under a provider that never answers", () => {
  it("returns inside its budget instead of waiting on the socket", async () => {
    hangingProvider();

    const started = Date.now();
    const result = await complete(ctx, {
      feature: "natural_language_analytics",
      system: "s",
      prompt: "p",
      timeoutMs: 300,
    });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("timed_out");
    // Generous upper bound: the point is that it returns at all, near the
    // budget, rather than hanging until the request resolves.
    expect(elapsed).toBeLessThan(3_000);
  });

  it("says how long it waited, in the sentence the user reads", async () => {
    hangingProvider();

    const result = await complete(ctx, {
      feature: "natural_language_analytics",
      system: "s",
      prompt: "p",
      timeoutMs: 2_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("2 seconds");
      expect(result.reason).toContain("Nothing was generated");
    }
  });

  it("still never throws", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("AI_DEFAULT_PROVIDER", "anthropic");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("socket hang up")))
    );

    await expect(
      complete(ctx, { feature: "natural_language_analytics", system: "s", prompt: "p", timeoutMs: 500 })
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("complete() with no provider configured", () => {
  it("returns immediately rather than waiting out a budget", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");

    const started = Date.now();
    const result = await complete(ctx, {
      feature: "natural_language_analytics",
      system: "s",
      prompt: "p",
      timeoutMs: 5_000,
    });

    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
