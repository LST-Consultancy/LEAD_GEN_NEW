/**
 * Background worker.
 *
 * Runs as its own process (`npm run worker`), separate from the web app, so a
 * long rescore cannot block a request and the two can be scaled apart.
 *
 * Start it after the web app. It installs the recurring schedules on boot,
 * which is idempotent — BullMQ keys a scheduler by id, so restarting replaces
 * the schedule rather than stacking another copy.
 */

import "dotenv/config";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { getRedis, isQueueConfigured } from "@/lib/queue/connection";
import { QUEUE_NAME, JOB, JOB_LABEL, JobEnvelopeError, schedulerIdOfJob, type JobName, type JobPayload } from "@/lib/queue/jobs";
import { judgeSearchJob } from "@/lib/opportunities/search-status";
import { failOpportunitySearch } from "@/lib/services/opportunity-ingestion";
import { installSchedules, removeSchedule, removeStaleSchedules } from "@/lib/queue/producer";
import { runJob } from "@/lib/queue/router";
import { db } from "@/lib/db";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);

function log(level: "info" | "warn" | "error", message: string, fields: Record<string, unknown> = {}) {
  // Structured, so it is greppable and can be shipped to a log aggregator
  // without reparsing prose (§108).
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "worker",
    message,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

async function main() {
  if (!isQueueConfigured()) {
    log("error", "REDIS_URL is not set, so there is nothing to consume", {
      hint: "Set REDIS_URL in .env, or run the app without a worker — queue-backed features will report themselves unavailable.",
    });
    process.exit(1);
  }

  const connection = getRedis();
  if (!connection) {
    log("error", "Could not create a Redis connection");
    process.exit(1);
  }

  // Schedules are per workspace, so a new tenant gets its own recurring jobs.
  const workspaces = await db.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  const installed = await installSchedules(workspaces.map((w) => w.id));
  log("info", "schedules installed", {
    workspaces: workspaces.length,
    schedulers: installed,
  });
  // Deleted workspaces and the old `name:workspace` id format left schedules
  // that fired hollow jobs ("Job undefined received no workspaceId").
  const removed = await removeStaleSchedules(workspaces.map((w) => w.id));
  if (removed.length) log("warn", "stale schedules removed", { count: removed.length, ids: removed });

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const started = Date.now();
      log("info", "job started", { jobId: job.id, job: job.name, attempt: job.attemptsMade + 1 });

      try {
        const result = await runJob(job.name, job.data, job.id);
        log("info", "job finished", {
          jobId: job.id,
          job: job.name,
          durationMs: Date.now() - started,
          result,
        });
        return result;
      } catch (err) {
        log("error", "job failed", {
          jobId: job.id,
          job: job.name,
          attempt: job.attemptsMade + 1,
          durationMs: Date.now() - started,
          error: (err as Error).message,
        });
        if (err instanceof JobEnvelopeError) {
          if (err.code === "workspace_gone" || err.code === "no_payload") {
            const scheduler = schedulerIdOfJob(job.id);
            if (scheduler && (await removeSchedule(scheduler))) log("warn", "stale schedule removed", { scheduler });
          }
          // A malformed job fails once; retrying cannot supply what is missing.
          throw new UnrecoverableError(err.message);
        }
        // Rethrown so BullMQ applies the configured backoff and retry count.
        throw err;
      }
    },
    {
      connection,
      concurrency: CONCURRENCY,
      // A job that outlives this is assumed dead and redelivered; handlers are
      // idempotent precisely so that redelivery is safe.
      lockDuration: 300_000,
    }
  );

  worker.on("failed", async (job, err) => {
    const exhausted = job && job.attemptsMade >= (job.opts.attempts ?? 1);
    if (exhausted) {
      log("error", "job exhausted its retries", {
        jobId: job?.id,
        job: job?.name,
        label: job ? JOB_LABEL[job.name as JobName] : undefined,
        error: err.message,
      });
      // Otherwise the search row says QUEUED forever to anyone not watching the status screen.
      if (job.name === JOB.OPPORTUNITY_DISCOVERY) {
        const { workspaceId, searchId } = job.data as JobPayload<typeof JOB.OPPORTUNITY_DISCOVERY>;
        const verdict = judgeSearchJob({ state: "failed", reason: err.message, attempts: job.attemptsMade }, new Date(job.timestamp), new Date());
        try { if (verdict && "fail" in verdict) await failOpportunitySearch(workspaceId, searchId, verdict.fail); }
        catch (e) { log("error", "could not mark search failed", { searchId, error: (e as Error).message }); }
      }
    }
  });

  worker.on("error", (err) => log("error", "worker error", { error: err.message }));

  log("info", "worker ready", {
    queue: QUEUE_NAME,
    concurrency: CONCURRENCY,
    jobs: Object.values(JOB_LABEL).length,
  });

  // Finish in-flight jobs before exiting, so a deploy does not abandon work
  // mid-transaction.
  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      log("info", "draining before shutdown", { signal });
      await worker.close();
      await db.$disconnect();
      log("info", "worker stopped");
      process.exit(0);
    });
  }
}

main().catch((err) => {
  log("error", "worker failed to start", { error: (err as Error).message });
  process.exit(1);
});
