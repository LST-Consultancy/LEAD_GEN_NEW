"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Play,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Metric } from "@/components/charts/metric";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { ApiError, api } from "@/lib/api/client";
import { formatAge, formatRelative } from "@/lib/format";
import { MANUAL_TRIGGER, type JobName } from "@/lib/queue/jobs";

type Monitor = {
  configured: boolean;
  health: { ok: true; latencyMs: number } | { ok: false; reason: string };
  counts: Record<string, number> | null;
  schedules: {
    name: string;
    label: string;
    cron: string;
    describe: string;
    installed: boolean;
    nextRunAt: string | null;
    lastSucceededAt: string | null;
  }[];
  workers: number | null;
  recent: {
    id: string;
    name: string;
    state: string;
    attemptsMade: number;
    failedReason: string | null;
    returnValue: unknown;
    createdAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
  }[];
  failureCount: number;
  systemActivity: {
    id: string;
    kind: string;
    summary: string;
    detail: string | null;
    occurredAt: string;
  }[];
};


export function JobsView({ initial }: { initial: Monitor }) {
  const router = useRouter();
  const [monitor, setMonitor] = React.useState(initial);
  const [running, setRunning] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  React.useEffect(() => setMonitor(initial), [initial]);

  async function refresh() {
    setRefreshing(true);
    try {
      setMonitor(await api.get<Monitor>("/api/jobs"));
    } catch {
      toast.error("Couldn't refresh the queue status");
    } finally {
      setRefreshing(false);
    }
  }

  async function trigger(job: string) {
    setRunning(job);
    try {
      await api.post("/api/jobs", { job });
      toast.success("Queued", {
        description: "Watch the recent runs below — it should appear within a few seconds.",
      });
      setTimeout(() => void refresh(), 3_000);
      router.refresh();
    } catch (err) {
      toast.error("Couldn't queue that job", {
        description: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setRunning(null);
    }
  }

  // §126 — with no queue the page says exactly that, rather than rendering
  // empty panels that read as "all quiet".
  if (!monitor.configured) {
    return (
      <div className="space-y-4">
        <Header onRefresh={refresh} refreshing={refreshing} />
        <Card>
          <EmptyState
            icon={Server}
            title="No queue is configured"
            description="Background work needs Redis. Without it the app stays fully usable, but scores are not recomputed, risk flags do not refresh, stale leads are not archived and retention does not run — all of which are scheduled jobs."
          />
          <CardFooter>
            <p className="text-2xs leading-relaxed text-muted">
              Set <code className="font-mono">REDIS_URL</code> in your environment and start the
              worker with <code className="font-mono">npm run worker</code>.
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Counted from Redis worker connections, not inferred from schedules.
  const workerDown = monitor.health.ok && monitor.workers === 0;

  return (
    <div className="space-y-4">
      <Header onRefresh={refresh} refreshing={refreshing} />

      {/* Health */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <Server className="size-3.5" />
              Queue health
            </CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {monitor.health.ok
                ? `Redis responded in ${monitor.health.latencyMs}ms`
                : "Redis is not reachable"}
            </p>
          </div>
          <Badge variant={monitor.health.ok ? "success" : "danger"} uppercase>
            {monitor.health.ok ? "Connected" : "Unreachable"}
          </Badge>
        </CardHeader>

        <CardContent className="space-y-3">
          {!monitor.health.ok ? (
            <p className="rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger-text">
              {monitor.health.reason}
            </p>
          ) : null}

          {workerDown ? (
            <p className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-xs leading-relaxed text-warning-text">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Redis is up but no worker is connected, so jobs will queue and nothing will run
              them. Start one with <code className="font-mono">npm run worker</code>.
            </p>
          ) : monitor.workers !== null ? (
            <p className="text-2xs text-muted">
              <span className="tabular">{monitor.workers}</span> worker {monitor.workers === 1 ? "connection" : "connections"} consuming. Counts below cover the whole queue, not only this workspace.
            </p>
          ) : null}

          {monitor.counts ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Waiting" value={String(monitor.counts.waiting ?? 0)} size="sm" />
              <Metric
                label="Active"
                value={String(monitor.counts.active ?? 0)}
                size="sm"
                tone={(monitor.counts.active ?? 0) > 0 ? "brand" : "neutral"}
              />
              <Metric label="Delayed" value={String(monitor.counts.delayed ?? 0)} size="sm" />
              <Metric
                label="Completed"
                value={String(monitor.counts.completed ?? 0)}
                size="sm"
                tone="good"
              />
              <Metric
                label="Failed"
                value={String(monitor.counts.failed ?? 0)}
                size="sm"
                tone={(monitor.counts.failed ?? 0) > 0 ? "serious" : "good"}
              />
              <Metric
                label="Prioritised"
                value={String(monitor.counts.prioritized ?? 0)}
                size="sm"
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Schedules */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recurring jobs</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {monitor.schedules.filter((s) => s.installed).length} of {monitor.schedules.length}{" "}
              registered with the queue
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-0">
          <ul className="divide-hairline border-t border-border-subtle">
            {monitor.schedules.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-primary">{s.label}</span>
                    <code className="font-mono text-2xs text-muted">{s.cron}</code>
                    {s.installed ? (
                      <Badge variant="success" size="sm" uppercase>
                        Scheduled
                      </Badge>
                    ) : (
                      <Tooltip content="Defined in code but not registered — no worker has booted since it was added.">
                        <Badge variant="warning" size="sm" uppercase>
                          Not registered
                        </Badge>
                      </Tooltip>
                    )}
                  </div>
                  <p className="mt-0.5 text-2xs leading-relaxed text-muted">{s.describe}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-secondary">
                    {s.nextRunAt ? (
                      <span className="flex items-center gap-1">
                        <Clock className="size-2.5" />
                        Next {formatRelative(s.nextRunAt)}
                      </span>
                    ) : null}
                    <span className={s.lastSucceededAt ? undefined : "text-muted"}>
                      {s.lastSucceededAt
                        ? `Last succeeded ${formatAge(s.lastSucceededAt)}`
                        : "No success in the last day's history"}
                    </span>
                  </p>
                </div>

                {MANUAL_TRIGGER[s.name as JobName]?.allowed ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={running === s.name}
                    disabled={running !== null || !monitor.health.ok}
                    onClick={() => void trigger(s.name)}
                  >
                    {running !== s.name && <Play />}
                    Run now
                  </Button>
                ) : (
                  // Say why there is no button, rather than leaving a gap.
                  <p className="max-w-[13rem] shrink-0 text-right text-2xs text-muted">
                    No manual run —{" "}
                    {
                      (
                        MANUAL_TRIGGER[s.name as JobName] as {
                          allowed: false;
                          because: string;
                        }
                      )?.because
                    }
                  </p>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Recent runs */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent runs</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {monitor.recent.length} in the retained window
              {monitor.failureCount > 0 ? ` · ${monitor.failureCount} failed` : ""}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-0">
          {monitor.recent.length === 0 ? (
            <EmptyState
              compact
              icon={Clock}
              title="Nothing has run yet"
              description="Trigger a job above, or wait for the next scheduled run."
            />
          ) : (
            <ul className="divide-hairline border-t border-border-subtle">
              {monitor.recent.map((job) => (
                <li key={job.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span className="mt-0.5 shrink-0">
                    {job.state === "completed" ? (
                      <CheckCircle2 className="size-3.5 text-success" />
                    ) : job.state === "failed" ? (
                      <XCircle className="size-3.5 text-danger" />
                    ) : (
                      <Clock className="size-3.5 text-muted" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <code className="font-mono text-xs text-primary">{job.name}</code>
                      {job.attemptsMade > 1 ? (
                        <Badge variant="warning" size="sm">
                          attempt {job.attemptsMade}
                        </Badge>
                      ) : null}
                      {job.durationMs !== null ? (
                        <span className="text-2xs text-muted tabular">{job.durationMs}ms</span>
                      ) : null}
                    </div>

                    {job.failedReason ? (
                      <p className="mt-0.5 text-2xs leading-relaxed text-danger-text">
                        {job.failedReason}
                      </p>
                    ) : job.returnValue ? (
                      <p className="mt-0.5 font-mono text-2xs leading-relaxed text-secondary">
                        {summarise(job.returnValue)}
                      </p>
                    ) : null}
                  </div>

                  <span className="shrink-0 text-2xs text-muted">
                    {job.finishedAt
                      ? formatAge(job.finishedAt)
                      : job.createdAt
                        ? `queued ${formatAge(job.createdAt)}`
                        : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* What the jobs actually changed */}
      {monitor.systemActivity.length > 0 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>What background work changed</CardTitle>
              <p className="mt-0.5 text-2xs text-muted">
                From the activity stream, so it survives independently of the queue&apos;s own history
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {monitor.systemActivity.map((a) => (
                <li key={a.id} className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs text-secondary">{a.summary}</span>
                    <span className="font-mono text-2xs text-muted">{a.kind}</span>
                    <span className="text-2xs text-muted">{formatAge(a.occurredAt)}</span>
                  </div>
                  {a.detail ? (
                    <p className="mt-0.5 text-2xs leading-relaxed text-muted">{a.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Header({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-primary">Background jobs</h1>
        <p className="mt-0.5 text-xs text-secondary">
          Scoring, risk detection, archiving and retention all run here. Every handler is idempotent,
          so a retry after a crash is safe.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={onRefresh} loading={refreshing}>
        {!refreshing && <RefreshCw />}
        Refresh
      </Button>
    </header>
  );
}

/** Renders a job's return value compactly, dropping the workspace id. */
function summarise(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([k]) => k !== "workspaceId"
  );
  if (entries.length === 0) return "no changes";
  return entries
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}
