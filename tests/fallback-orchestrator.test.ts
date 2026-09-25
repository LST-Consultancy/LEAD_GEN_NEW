import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { attempt, attemptsSummary, providersFor, type FallbackCtx } from "@/lib/services/fallback-orchestrator";
import { ProviderRequestError } from "@/lib/providers/provider-errors";
import { classifyProviderError } from "@/lib/enrichment/provider-outcome";
import { fallbackConfigSchema } from "@/lib/enrichment/fallback";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

async function ws() {
  const w = await makeWorkspace("FallbackOrchestrator"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  return w.workspace.id;
}
function fx(workspaceId: string, over: Partial<Omit<FallbackCtx, "cfg">> & { cfg?: Record<string, unknown> } = {}): FallbackCtx {
  const { cfg, ...rest } = over;
  return { workspaceId, runId: randomUUID(), refresh: false, freshDays: 30, cfg: fallbackConfigSchema.parse({ enabled: true, ...(cfg ?? {}) }), cancelled: async () => false, attempts: [], ...rest };
}
const call = (targetKey: string, cost: "free" | "credit" = "credit") => ({ provider: "hunter" as const, operation: "emails" as const, call: "Email Finder", targetKey, target: targetKey, cost });

describe("fallback orchestrator", () => {
  it("records each attempt in the ledger before calling, and a redelivered job neither repeats a finished call nor re-pays a lost one", async () => {
    const id = await ws(); const f = fx(id);
    const fn = vi.fn(async () => ({ outcome: "found" as const, value: 1 }));
    expect((await attempt(f, call("person:a"), fn)).record.outcome).toBe("found");
    expect((await attempt(f, call("person:a"), fn)).record.outcome).toBe("cached");
    expect(fn).toHaveBeenCalledTimes(1);
    // A worker died after reserving: the row is STARTED and its answer is unknown — not asked again.
    await db.providerCall.create({ data: { workspaceId: id, enrichmentRunId: f.runId, provider: "hunter", operation: "emails", targetKey: "person:b", units: 1 } });
    const lost = await attempt(f, call("person:b"), fn);
    expect(lost.record).toMatchObject({ outcome: "interrupted", detail: expect.stringContaining("Run again") });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(await db.providerCall.findMany({ where: { workspaceId: id, enrichmentRunId: f.runId }, select: { status: true } })).toEqual(expect.arrayContaining([{ status: "FOUND" }, { status: "STARTED" }]));
  });

  it("does not ask again inside the freshness window unless the run is a refresh", async () => {
    const id = await ws();
    const fn = vi.fn(async () => ({ outcome: "no_match" as const }));
    await attempt(fx(id), call("person:c"), fn);
    expect((await attempt(fx(id), call("person:c"), fn)).record.outcome).toBe("cached");
    expect((await attempt(fx(id, { refresh: true }), call("person:c"), fn)).record.outcome).toBe("no_match");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("holds the per-run and daily paid caps under concurrency, and counts free calls separately", async () => {
    const id = await ws(); const f = fx(id, { cfg: { maxLookupsPerRun: 2, maxLookupsPerDay: 3, maxFreeCallsPerRun: 1 } });
    const fn = vi.fn(async () => ({ outcome: "no_match" as const }));
    const out = await Promise.all(["1", "2", "3", "4", "5"].map(k => attempt(f, call(`p:${k}`), fn)));
    expect(out.filter(o => o.record.outcome === "no_match")).toHaveLength(2);
    expect(out.filter(o => o.record.outcome === "budget")).toHaveLength(3);
    // A second run the same day meets the daily cap after one more.
    const g = fx(id, { cfg: { maxLookupsPerRun: 5, maxLookupsPerDay: 3 } });
    expect((await attempt(g, call("p:6"), fn)).record.outcome).toBe("no_match");
    expect((await attempt(g, call("p:7"), fn)).record).toMatchObject({ outcome: "budget", detail: expect.stringContaining("Today's limit") });
    // Free calls have their own limit and do not use the paid allowance.
    expect((await attempt(f, call("free:1", "free"), fn)).record.outcome).toBe("no_match");
    expect((await attempt(f, call("free:2", "free"), fn)).record.outcome).toBe("budget");
    expect(await db.providerCall.count({ where: { workspaceId: id, units: { gt: 0 } } })).toBe(3);
  });

  it("keeps key refused, not entitled, quota, rate limit, transient and malformed apart", async () => {
    const id = await ws(); const f = fx(id);
    const fail = (e: unknown) => async () => { throw e; };
    expect((await attempt(f, call("e:401"), fail(new ProviderRequestError("x", "http", 401)))).record.outcome).toBe("invalid_credentials");
    expect((await attempt(f, call("e:403"), fail(new ProviderRequestError("x", "http", 403)))).record.outcome).toBe("rate_limited");
    expect((await attempt(f, call("e:429"), fail(new ProviderRequestError("x", "http", 429)))).record.outcome).toBe("quota");
    expect((await attempt(f, call("e:503"), fail(new ProviderRequestError("x", "http", 503)))).record.outcome).toBe("transient");
    expect((await attempt(f, call("e:zod"), fail(new ZodError([])))).record.outcome).toBe("malformed");
    expect(classifyProviderError("apollo", { status: 403, providerCode: "API_INACCESSIBLE" }).outcome).toBe("not_entitled");
    expect(classifyProviderError("signalhire", { status: 402 }).outcome).toBe("quota");
    expect(classifyProviderError("hunter", { status: 403, providerCode: "no_discover_access" }).outcome).toBe("not_entitled");
    expect(attemptsSummary(f.attempts)).toContain("key refused");
  });

  it("stops before calling when the run is cancelled", async () => {
    const id = await ws(); const fn = vi.fn();
    expect((await attempt(fx(id, { cancelled: async () => true }), call("x"), fn)).record.outcome).toBe("cancelled");
    expect(fn).not.toHaveBeenCalled();
  });

  it("offers no provider for a switched-off operation, and skips unsupported and unconnected ones with a reason", async () => {
    const id = await ws();
    expect(await providersFor(fx(id, { cfg: { operations: { company: true, people: true, emails: false, verify: true } } }), "emails")).toMatchObject({ ready: [], off: expect.stringContaining("switched off") });
    const r = await providersFor(fx(id), "verify");
    expect(r.ready).toEqual([]);
    expect(r.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ provider: "signalhire", outcome: "unsupported" }), expect.objectContaining({ provider: "apollo", outcome: "unsupported" }), expect.objectContaining({ provider: "hunter", outcome: "not_connected" })]));
  });
});
