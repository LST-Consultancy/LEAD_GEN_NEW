import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db, makeWorkspace, makeLead, cleanup } from "./helpers/fixtures";
import {
  JOB,
  JOB_SCHEDULE,
  JobEnvelopeError,
  schedulerId,
  schedulerIdOfJob,
  staleSchedulerIds,
  validateJobEnvelope,
  type JobName,
} from "@/lib/queue/jobs";
import { runJob } from "@/lib/queue/router";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("job envelope", () => {
  const ws = randomUUID();

  it("accepts a known job with a workspace", () => {
    expect(validateJobEnvelope("1", JOB.RESCORE_WORKSPACE, { workspaceId: ws })).toEqual({ name: JOB.RESCORE_WORKSPACE, workspaceId: ws });
  });

  it("names a hollow record for what it is instead of 'Job undefined'", () => {
    const id = `repeat:${schedulerId(JOB.GENERATE_DAILY_BRIEFS, ws)}:1790206500000`;
    for (const data of [undefined, {}]) {
      const err = (() => { try { validateJobEnvelope(id, undefined, data); } catch (e) { return e as JobEnvelopeError; } })();
      expect(err).toBeInstanceOf(JobEnvelopeError);
      expect(err?.code).toBe("no_payload");
      expect(err?.retryable).toBe(false);
      expect(err?.message).toContain(id);
      expect(err?.message).not.toContain("undefined");
    }
  });

  it("refuses an unknown job and a missing or malformed workspace", () => {
    expect(() => validateJobEnvelope("2", "leads.old_job", { workspaceId: ws })).toThrow(/does not run/);
    expect(() => validateJobEnvelope("3", JOB.RESCORE_WORKSPACE, {})).toThrow(/no valid workspaceId/);
    expect(() => validateJobEnvelope("4", JOB.RESCORE_WORKSPACE, { workspaceId: "all" })).toThrow(/no valid workspaceId/);
  });

  it("recovers the scheduler from a repeat job id in either id format", () => {
    expect(schedulerIdOfJob(`repeat:rescore.workspace-${ws}:1790206500000`)).toBe(`rescore.workspace-${ws}`);
    expect(schedulerIdOfJob(`repeat:rescore.workspace:${ws}:1790206500000`)).toBe(`rescore.workspace:${ws}`);
    expect(schedulerIdOfJob("manual-123")).toBeNull();
  });
});

describe("stale schedules", () => {
  it("keeps exactly the expected set and flags legacy ids, deleted workspaces and unscheduled jobs", () => {
    const live = randomUUID(); const gone = randomUUID();
    const expected = (Object.keys(JOB_SCHEDULE) as JobName[]).map((n) => schedulerId(n, live));
    const existing = [
      ...expected,
      `${JOB.RESCORE_WORKSPACE}:${live}`,          // pre-safeJobId format: ran every job twice
      schedulerId(JOB.RESCORE_WORKSPACE, gone),     // workspace deleted
      schedulerId(JOB.SEND_MESSAGE, live),          // not a recurring job
    ];
    expect(staleSchedulerIds(existing, [live]).sort()).toEqual([
      `${JOB.RESCORE_WORKSPACE}:${live}`,
      schedulerId(JOB.RESCORE_WORKSPACE, gone),
      schedulerId(JOB.SEND_MESSAGE, live),
    ].sort());
    expect(staleSchedulerIds(expected, [live])).toEqual([]);
  });
});

describe("running recurring jobs", () => {
  // Stated, not inherited from .env: nothing here may call a model or a mail relay.
  beforeEach(() => {
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "SMTP_URL", "RESEND_API_KEY", "AWS_SES_ACCESS_KEY_ID", "POSTMARK_SERVER_TOKEN", "GOOGLE_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_ID", "EMAIL_PROVIDER"]) vi.stubEnv(k, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a job for a workspace that no longer exists, and changes nothing", async () => {
    const before = await db.lead.count();
    await expect(runJob(JOB.ARCHIVE_STALE_LEADS, { workspaceId: randomUUID() }, "repeat:x:1")).rejects.toMatchObject({ code: "workspace_gone" });
    await expect(runJob(undefined, undefined, "repeat:x:2")).rejects.toMatchObject({ code: "no_payload" });
    expect(await db.lead.count()).toBe(before);
  });

  it("runs every scheduled job with a valid payload, twice, without the second run moving a row", async () => {
    const w = await makeWorkspace("JobEnvelope");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    await makeLead(w.workspace.id, { ownerId: w.user.id });
    const names = Object.keys(JOB_SCHEDULE) as JobName[];
    expect(names.length).toBeGreaterThanOrEqual(14);

    const counts = async () => Promise.all([
      db.lead.count({ where: { workspaceId: w.workspace.id } }),
      db.notification.count({ where: { workspaceId: w.workspace.id } }),
      db.nextBestAction.count({ where: { workspaceId: w.workspace.id } }),
      db.activity.count({ where: { workspaceId: w.workspace.id } }),
    ]);
    for (const name of names) await runJob(name, { workspaceId: w.workspace.id }, `test-${name}-1`);
    const afterFirst = await counts();
    for (const name of names) await runJob(name, { workspaceId: w.workspace.id }, `test-${name}-2`);
    expect(await counts()).toEqual(afterFirst);
  }, 60_000);
});
