import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { judgeSearchJob, MISSING_JOB_GRACE_MS, type SearchJobOutcome } from "@/lib/opportunities/search-status";

vi.mock("@/lib/queue/producer", async (original) => ({ ...(await original<typeof import("@/lib/queue/producer")>()), getJobOutcome: vi.fn() }));
import { getJobOutcome } from "@/lib/queue/producer";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { getOpportunitySearch } from "@/lib/services/opportunities";
import { failOpportunitySearch, ingestOpportunity } from "@/lib/services/opportunity-ingestion";
import { parseOpportunityQuery } from "@/lib/opportunities/query-parser";
import type { SourceDocument } from "@/lib/opportunities/extractor";

const now = new Date("2026-09-23T10:00:00Z");
const fresh = new Date(now.getTime() - 10_000);
const old = new Date(now.getTime() - MISSING_JOB_GRACE_MS - 1);

describe("judgeSearchJob", () => {
  it("fails a job that exhausted its retries, and names a stale worker specifically", () => {
    expect(judgeSearchJob({ state: "failed", reason: "boom", attempts: 3 }, fresh, now)).toEqual({ fail: expect.stringContaining("after 3 failed attempts") });
    expect(judgeSearchJob({ state: "failed", reason: "No handler registered for job opportunity.discovery", attempts: 1 }, fresh, now)).toEqual({ fail: expect.stringContaining("Restart the worker") });
  });
  it("tolerates a job missing just after creation but fails one that stays missing", () => {
    expect(judgeSearchJob({ state: "missing" }, fresh, now)).toBeNull();
    expect(judgeSearchJob({ state: "missing" }, old, now)).toEqual({ fail: expect.stringContaining("no longer in the queue") });
  });
  it("explains a wait with no worker without failing it, and stays quiet otherwise", () => {
    expect(judgeSearchJob({ state: "waiting", workers: 0 }, old, now)).toEqual({ notice: expect.stringContaining("No background worker") });
    const quiet: SearchJobOutcome[] = [{ state: "waiting", workers: 1 }, { state: "waiting", workers: null }, { state: "in_progress" }, { state: "unavailable" }];
    for (const o of quiet) expect(judgeSearchJob(o, old, now)).toBeNull();
  });
});

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
async function workspace() { const w = await makeWorkspace("SearchStatusFixture"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id); return w; }
const criteria = parseOpportunityQuery("NetSuite implementation");
async function search(w: Awaited<ReturnType<typeof workspace>>, state: "QUEUED" | "COMPLETED" = "QUEUED") {
  return db.opportunitySearch.create({ data: { workspaceId: w.workspace.id, createdById: w.user.id, query: "NetSuite implementation", criteria, providers: ["brave"], idempotencyKey: randomUUID(), state } });
}
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
beforeEach(() => { vi.mocked(getJobOutcome).mockReset(); });

describe("search status read", () => {
  it("persists FAILED when the queue says the job died, so the screen stops showing QUEUED", async () => {
    const w = await workspace(); const s = await search(w);
    vi.mocked(getJobOutcome).mockResolvedValue({ state: "failed", reason: "No handler registered for job opportunity.discovery", attempts: 1 });
    const read = await getOpportunitySearch(w.ctx, s.id);
    expect(read.state).toBe("FAILED"); expect(read.error).toContain("Restart the worker"); expect(read.finishedAt).not.toBeNull();
    expect((await db.opportunitySearch.findUniqueOrThrow({ where: { id: s.id } })).state).toBe("FAILED");
  });
  it("reports a missing worker as a notice without changing the row", async () => {
    const w = await workspace(); const s = await search(w);
    vi.mocked(getJobOutcome).mockResolvedValue({ state: "waiting", workers: 0 });
    const read = await getOpportunitySearch(w.ctx, s.id);
    expect(read.state).toBe("QUEUED"); expect(read.notice).toContain("No background worker");
  });
  it("does not consult the queue for a finished search, and never un-finishes one", async () => {
    const w = await workspace(); const s = await search(w, "COMPLETED");
    expect((await getOpportunitySearch(w.ctx, s.id)).state).toBe("COMPLETED");
    expect(getJobOutcome).not.toHaveBeenCalled();
    expect(await failOpportunitySearch(w.workspace.id, s.id, "late failure")).toBe(false);
    expect((await db.opportunitySearch.findUniqueOrThrow({ where: { id: s.id } })).state).toBe("COMPLETED");
  });
  it("counts results awaiting buyer review for this search only, and stays tenant-scoped", async () => {
    vi.mocked(getJobOutcome).mockResolvedValue({ state: "in_progress" });
    const w = await workspace(); const other = await workspace(); const s = await search(w); const sibling = await search(w);
    const page: SourceDocument = { provider: "brave", kind: "PUBLIC_WEB", externalId: "https://fixture.invalid/a", title: "Looking for a NetSuite implementation partner", description: "We are looking for a NetSuite implementation partner.", company: { name: "" }, postedAt: null, sourceUrl: "https://fixture.invalid/a", rawSourceReference: {}, status: "UNKNOWN" };
    await ingestOpportunity(w.workspace.id, s.id, page, criteria, { allowedExport: false, retentionDays: 30 });
    await ingestOpportunity(w.workspace.id, s.id, { ...page, externalId: "https://fixture.invalid/b", sourceUrl: "https://fixture.invalid/b" }, criteria, { allowedExport: false, retentionDays: 30 });
    expect((await getOpportunitySearch(w.ctx, s.id)).needsReview).toBe(2);
    expect((await getOpportunitySearch(w.ctx, sibling.id)).needsReview).toBe(0);
    await expect(getOpportunitySearch(other.ctx, s.id)).rejects.toMatchObject({ status: 404 });
  });
});
