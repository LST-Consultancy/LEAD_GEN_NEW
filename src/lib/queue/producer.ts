import "server-only";
import { Queue, type JobsOptions } from "bullmq";
import { getRedis, isQueueConfigured } from "@/lib/queue/connection";
import {
  JOB_POLICY,
  JOB_SCHEDULE,
  QUEUE_NAME,
  safeJobId,
  schedulerId,
  staleSchedulerIds,
  type JobName,
  type JobPayload,
} from "@/lib/queue/jobs";
import { log } from "@/lib/observability/log";
import type { SearchJobOutcome } from "@/lib/opportunities/search-status";

const globalForQueue = globalThis as unknown as { srQueue?: Queue | null };

function queue(): Queue | null {
  if (!isQueueConfigured()) return null;
  if (globalForQueue.srQueue !== undefined) return globalForQueue.srQueue;

  const connection = getRedis();
  if (!connection) {
    globalForQueue.srQueue = null;
    return null;
  }

  globalForQueue.srQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      // Keep a window of history for the monitor without growing forever.
      removeOnComplete: { age: 86_400, count: 500 },
      removeOnFail: { age: 604_800, count: 1_000 },
    },
  });
  return globalForQueue.srQueue;
}

/**
 * Appends a time bucket to a dedupe key so it suppresses repeats for a window
 * rather than forever.
 */
function bucketed(key: string, windowSec: number): string {
  if (windowSec <= 0) return key;
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  return `${key}-w${bucket}`;
}

export type EnqueueResult =
  | { queued: true; jobId: string }
  | { queued: false; reason: "not_configured" | "duplicate" | "error"; detail: string };

/**
 * Adds a job to the queue.
 *
 * Never throws. A queue outage must not fail the user's request — the caller
 * gets `queued: false` with a reason it can surface, and the work can be
 * triggered again later.
 *
 * `dedupeKey` becomes the BullMQ job id, so enqueueing the same logical work
 * twice is a no-op rather than duplicate processing (§123).
 */
export async function enqueue<N extends JobName>(
  name: N,
  payload: JobPayload<N>,
  opts: {
    dedupeKey?: string;
    /**
     * How long a dedupe key suppresses a repeat, in seconds. Default 120.
     *
     * A key with no window is permanent, because BullMQ keeps completed jobs in
     * history and rejects a reused id — which silently swallows a *later*
     * legitimate request. Bucketing by time collapses a burst (three saves in
     * ten seconds) while still letting a change a minute later run.
     */
    dedupeWindowSec?: number;
    delayMs?: number;
    priority?: number;
  } = {}
): Promise<EnqueueResult> {
  const q = queue();
  if (!q) {
    return {
      queued: false,
      reason: "not_configured",
      detail: "No queue is configured, so this will not run in the background.",
    };
  }

  const policy = JOB_POLICY[name];
  const jobOptions: JobsOptions = {
    attempts: policy.attempts,
    backoff: { type: "exponential", delay: policy.backoffMs },
    delay: opts.delayMs,
    priority: opts.priority,
    ...(opts.dedupeKey
      ? { jobId: safeJobId(bucketed(opts.dedupeKey, opts.dedupeWindowSec ?? 120)) }
      : {}),
  };

  try {
    const job = await q.add(name, payload, jobOptions);
    // BullMQ returns the existing job when the id already exists.
    return { queued: true, jobId: String(job.id) };
  } catch (err) {
    log.queue.error("failed to enqueue", { job: name, err });
    return {
      queued: false,
      reason: "error",
      detail: "The queue could not be reached. Nothing was lost — try again.",
    };
  }
}

/**
 * Installs the recurring schedules. Idempotent: BullMQ keys a repeatable job by
 * its name plus pattern, so calling this on every worker boot replaces the
 * schedule rather than stacking duplicates.
 */
export async function installSchedules(workspaceIds: string[]): Promise<number> {
  const q = queue();
  if (!q) return 0;

  let installed = 0;
  for (const [name, schedule] of Object.entries(JOB_SCHEDULE) as [
    JobName,
    { cron: string; describe: string },
  ][]) {
    for (const workspaceId of workspaceIds) {
      try {
        // BullMQ 6 keys a scheduler by this id, so re-running on every worker
        // boot updates the existing schedule instead of stacking a second one.
        await q.upsertJobScheduler(
          schedulerId(name, workspaceId),
          { pattern: schedule.cron },
          {
            name,
            data: { workspaceId } as never,
            opts: {
              attempts: JOB_POLICY[name].attempts,
              backoff: { type: "exponential", delay: JOB_POLICY[name].backoffMs },
            },
          }
        );
        installed++;
      } catch (err) {
        log.queue.error("failed to schedule", { job: name, workspaceId, err });
      }
    }
  }
  return installed;
}

/**
 * Removes schedulers that no longer correspond to a live workspace and a
 * scheduled job. Runs after `installSchedules` on worker boot, so it only ever
 * removes what the current code would not have installed. Queued one-off work
 * is untouched; only recurring definitions are reconciled.
 */
export async function removeStaleSchedules(workspaceIds: string[]): Promise<string[]> {
  const q = queue();
  if (!q) return [];
  const existing = (await q.getJobSchedulers(0, -1)).map((s) => s.key);
  const stale = staleSchedulerIds(existing, workspaceIds);
  const removed: string[] = [];
  for (const id of stale) {
    try { if (await q.removeJobScheduler(id)) removed.push(id); }
    catch (err) { log.queue.error("failed to remove stale schedule", { id, err }); }
  }
  return removed;
}

/** Removes one scheduler, e.g. when its workspace turns out to be gone. */
export async function removeSchedule(id: string): Promise<boolean> {
  const q = queue();
  if (!q) return false;
  try { return await q.removeJobScheduler(id); } catch { return false; }
}

/**
 * When each job last finished successfully for a workspace. Read from the
 * retained completed-job window (a day, up to 500 jobs), so "never" means
 * "not within that window" and the monitor says so.
 */
export async function lastSuccessByJob(workspaceId: string): Promise<Partial<Record<string, string>>> {
  const q = queue();
  if (!q) return {};
  try {
    const jobs = await q.getJobs(["completed"], 0, 499);
    const out: Partial<Record<string, string>> = {};
    for (const j of jobs) {
      if (!j?.finishedOn || (j.data as { workspaceId?: string })?.workspaceId !== workspaceId) continue;
      const at = new Date(j.finishedOn).toISOString();
      if (!out[j.name] || out[j.name]! < at) out[j.name] = at;
    }
    return out;
  } catch (err) {
    log.queue.warn("last success unavailable", { err });
    return {};
  }
}

/** Queue depth and recent outcomes, for the job monitor. */
export async function getQueueStats(): Promise<{
  configured: boolean;
  counts: Record<string, number> | null;
  repeatable: { key: string; name: string; pattern: string | null; next: number | null }[];
}> {
  const q = queue();
  if (!q) return { configured: false, counts: null, repeatable: [] };

  try {
    const counts = await q.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "prioritized"
    );
    const repeat = await q.getJobSchedulers(0, -1);
    return {
      configured: true,
      counts,
      repeatable: repeat.map((r) => ({
        key: r.key,
        name: r.name ?? "unknown",
        pattern: r.pattern ?? null,
        next: r.next ? Number(r.next) : null,
      })),
    };
  } catch (err) {
    log.queue.warn("stats unavailable", { err });
    return { configured: true, counts: null, repeatable: [] };
  }
}

/** Recent jobs with their outcome, newest first. */
export async function getRecentJobs(limit = 40) {
  const q = queue();
  if (!q) return [];

  try {
    const jobs = await q.getJobs(["completed", "failed", "active", "waiting", "delayed"], 0, limit);
    return jobs
      .filter((j): j is NonNullable<typeof j> => Boolean(j))
      .map((j) => ({
        id: String(j.id),
        name: j.name,
        state: j.finishedOn ? (j.failedReason ? "failed" : "completed") : "pending",
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason ?? null,
        returnValue: j.returnvalue ?? null,
        createdAt: j.timestamp ? new Date(j.timestamp).toISOString() : null,
        finishedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
        durationMs: j.finishedOn && j.processedOn ? j.finishedOn - j.processedOn : null,
        workspaceId: (j.data as { workspaceId?: string })?.workspaceId ?? null,
      }))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  } catch (err) {
    log.queue.warn("recent jobs unavailable", { err });
    return [];
  }
}

/** Where a job actually is, so a record that still says "queued" can be checked against the queue. */
export async function getJobOutcome(jobId: string): Promise<SearchJobOutcome> {
  const q = queue();
  if (!q) return { state: "unavailable" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Queue timeout")), 2500); });
  try {
    const job = await Promise.race([q.getJob(safeJobId(jobId)), timeout]);
    if (!job) return { state: "missing" };
    // BullMQ reports "failed" only once retries are exhausted; a retry in backoff is "delayed".
    const state = await Promise.race([job.getState(), timeout]);
    if (state === "failed") return { state: "failed", reason: job.failedReason ?? "", attempts: job.attemptsMade };
    if (state === "waiting" || state === "prioritized") {
      const workers = await Promise.race([q.getWorkers(), timeout]);
      return { state: "waiting", workers: workers.length };
    }
    return { state: "in_progress" };
  } catch (err) {
    log.queue.warn("job outcome unavailable", { jobId, err });
    return { state: "unavailable" };
  } finally { if (timer) clearTimeout(timer); }
}

/** Redis worker connections, not a guess based on queued jobs. Bounded for settings. */
export async function getWorkerReadiness(): Promise<{ configured: boolean; reachable: boolean; workers: number | null }> {
  const q = queue();
  if (!q) return { configured: false, reachable: false, workers: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const workers = await Promise.race([q.getWorkers(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Queue timeout")), 2500); })]);
    return { configured: true, reachable: true, workers: workers.length };
  } catch { return { configured: true, reachable: false, workers: null }; }
  finally { if (timer) clearTimeout(timer); }
}
