import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { pingQueue, isQueueConfigured } from "@/lib/queue/connection";
import { getQueueStats, getRecentJobs, enqueue } from "@/lib/queue/producer";
import { JOB_LABEL, JOB_SCHEDULE, type JobName } from "@/lib/queue/jobs";
import { assertPermission } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * §108 — the queue's own status page.
 *
 * Background work that nobody can see is background work nobody trusts. This
 * reports whether a worker is actually consuming, what ran, and what failed,
 * and is explicit when no queue is configured at all rather than showing an
 * empty dashboard that looks like "nothing to do".
 */
export async function getJobMonitor(ctx: AuthContext) {
  assertPermission(ctx, PERMISSIONS.WORKSPACE_MANAGE);

  const [health, stats, recent, lastRuns] = await Promise.all([
    pingQueue(),
    getQueueStats(),
    getRecentJobs(40),
    // What the database says actually happened, independent of Redis history.
    db.activity.findMany({
      where: { workspaceId: ctx.workspaceId, actorType: "SYSTEM" },
      orderBy: { occurredAt: "desc" },
      take: 10,
      select: { id: true, kind: true, summary: true, detail: true, occurredAt: true },
    }),
  ]);

  const schedules = (Object.entries(JOB_SCHEDULE) as [JobName, { cron: string; describe: string }][])
    .map(([name, s]) => {
      const live = stats.repeatable.find((r) => r.name === name);
      return {
        name,
        label: JOB_LABEL[name],
        cron: s.cron,
        describe: s.describe,
        // A schedule defined in code but absent from Redis means no worker has
        // booted since it was added.
        installed: Boolean(live),
        nextRunAt: live?.next ? new Date(live.next).toISOString() : null,
      };
    })
    .sort((a, b) => (a.nextRunAt ?? "z").localeCompare(b.nextRunAt ?? "z"));

  const failures = recent.filter((j) => j.state === "failed");

  return {
    configured: isQueueConfigured(),
    health,
    counts: stats.counts,
    schedules,
    recent: recent.filter((j) => !j.workspaceId || j.workspaceId === ctx.workspaceId),
    failureCount: failures.length,
    systemActivity: lastRuns.map((a) => ({
      id: a.id,
      kind: a.kind,
      summary: a.summary,
      detail: a.detail,
      occurredAt: a.occurredAt.toISOString(),
    })),
  };
}

/** Lets an admin force a job from the UI, same as the CLI. */
export async function triggerJob(ctx: AuthContext, name: JobName) {
  assertPermission(ctx, PERMISSIONS.WORKSPACE_MANAGE);
  return enqueue(
    name,
    { workspaceId: ctx.workspaceId } as never,
    { dedupeKey: `manual-${name}-${ctx.workspaceId}-${Date.now()}` }
  );
}
