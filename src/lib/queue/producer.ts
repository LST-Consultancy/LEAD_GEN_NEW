import "server-only";
import { Queue, type JobsOptions } from "bullmq";
import { getRedis, isQueueConfigured } from "@/lib/queue/connection";
import {
  JOB_POLICY,
  JOB_SCHEDULE,
  QUEUE_NAME,
  type JobName,
  type JobPayload,
} from "@/lib/queue/jobs";
import { log } from "@/lib/observability/log";

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
 * BullMQ reserves ':' as its own key separator and rejects a custom job id
 * containing one, so dedupe keys are normalised here rather than every caller
 * having to remember. Anything outside a safe set becomes a dash.
 */
function safeJobId(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 200);
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
          safeJobId(`${name}-${workspaceId}`),
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

/** Queue depth and recent outcomes, for the job monitor. */
export async function getQueueStats(): Promise<{
  configured: boolean;
  counts: Record<string, number> | null;
  repeatable: { name: string; pattern: string | null; next: number | null }[];
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
    const repeat = await q.getJobSchedulers(0, 50);
    return {
      configured: true,
      counts,
      repeatable: repeat.map((r) => ({
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
