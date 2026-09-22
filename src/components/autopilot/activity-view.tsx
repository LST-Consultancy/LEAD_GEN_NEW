"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ChevronDown, ChevronRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { formatAge, formatNumber } from "@/lib/format";

type Run = {
  id: string;
  trigger: string;
  state: string;
  summary: string | null;
  pointsSpent: number;
  actionsTaken: number;
  actionsHeld: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  agent: { id: string; name: string; kind: string };
  actions: {
    id: string;
    sequence: number;
    tool: string;
    riskClass: string;
    summary: string;
    state: string;
    pointsSpent: number;
    occurredAt: string;
    executable: boolean;
  }[];
};

const RISK_VARIANT: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  READ: "neutral",
  WRITE: "info",
  SPEND: "warning",
  EXTERNAL: "danger",
};

const OUTCOMES = [
  ["all", "All"],
  ["completed", "Done"],
  ["pending_approval", "Held"],
  ["deferred", "Waiting"],
  ["refused", "Refused"],
  ["failed", "Failed"],
] as const;

export function ActivityView({ runs }: { runs: Run[] }) {
  const [expanded, setExpanded] = useState<string | null>(runs[0]?.id ?? null);
  const [agentFilter, setAgentFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");

  const agents = useMemo(
    () => [...new Map(runs.map((r) => [r.agent.id, r.agent])).values()],
    [runs]
  );

  const filtered = useMemo(
    () =>
      runs.filter((r) => {
        if (agentFilter !== "all" && r.agent.id !== agentFilter) return false;
        if (riskFilter !== "all" && !r.actions.some((a) => a.riskClass === riskFilter)) return false;
        if (outcomeFilter !== "all" && !r.actions.some((a) => a.state === outcomeFilter))
          return false;
        return true;
      }),
    [runs, agentFilter, riskFilter, outcomeFilter]
  );

  const totals = filtered.reduce(
    (acc, r) => ({
      actions: acc.actions + r.actions.length,
      points: acc.points + r.pointsSpent,
      held: acc.held + r.actionsHeld,
      refused: acc.refused + r.actions.filter((a) => a.state === "refused").length,
    }),
    { actions: 0, points: 0, held: 0, refused: 0 }
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Agent Activity</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Every automated action, timestamped and traceable to the run that produced it. Refusals
          and deferrals are here alongside successes, because an agent that was stopped is a
          different fact from one that did nothing.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Actions" value={formatNumber(totals.actions)} hint="in view" />
        <Stat label="Points spent" value={formatNumber(totals.points)} hint="by automation" />
        <Stat label="Held for a person" value={formatNumber(totals.held)} hint="awaited approval" />
        <Stat label="Refused" value={formatNumber(totals.refused)} hint="never allowed" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Filter
          label="Agent"
          value={agentFilter}
          onChange={setAgentFilter}
          options={[["all", "All agents"], ...agents.map((a) => [a.id, a.name] as [string, string])]}
        />
        <Filter
          label="Risk"
          value={riskFilter}
          onChange={setRiskFilter}
          options={[
            ["all", "Any risk"],
            ["READ", "Read"],
            ["WRITE", "Write"],
            ["SPEND", "Spend"],
            ["EXTERNAL", "External"],
          ]}
        />
        <Filter
          label="Outcome"
          value={outcomeFilter}
          onChange={setOutcomeFilter}
          options={OUTCOMES.map(([k, v]) => [k, v] as [string, string])}
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Activity}
              title={runs.length === 0 ? "No runs recorded" : "Nothing matches these filters"}
              description={
                runs.length === 0
                  ? "When an agent runs, every action it takes — and every one it is stopped from taking — is recorded here with its risk class, cost and outcome."
                  : "Widen the filters to see more."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="flex min-w-0 items-start gap-2 text-left"
                  aria-expanded={expanded === r.id}
                >
                  {expanded === r.id ? (
                    <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted" />
                  ) : (
                    <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted" />
                  )}
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate">{r.agent.name}</span>
                      <Badge
                        variant={
                          r.state === "SUCCEEDED"
                            ? "success"
                            : r.state === "FAILED"
                              ? "danger"
                              : "neutral"
                        }
                        size="sm"
                      >
                        {r.state.toLowerCase()}
                      </Badge>
                    </CardTitle>
                    <p className="mt-0.5 truncate text-2xs text-muted">
                      {r.summary ?? "No summary recorded"} · triggered by {r.trigger} ·{" "}
                      {formatAge(r.startedAt)}
                    </p>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-3 text-right">
                  <div>
                    <p className="text-2xs text-muted">Actions</p>
                    <p className="text-sm font-semibold tabular text-primary">
                      {r.actions.length}
                    </p>
                  </div>
                  {r.pointsSpent > 0 ? (
                    <div>
                      <p className="text-2xs text-muted">Points</p>
                      <p className="text-sm font-semibold tabular text-warning-text">
                        {r.pointsSpent}
                      </p>
                    </div>
                  ) : null}
                </div>
              </CardHeader>

              {r.errorMessage ? (
                <div className="px-4 pb-2">
                  <p className="rounded-md border border-danger-border bg-danger-subtle px-2.5 py-2 text-2xs text-danger-text">
                    <AlertTriangle className="mr-1 inline size-3" />
                    {r.errorMessage}
                  </p>
                </div>
              ) : null}

              {expanded === r.id ? (
                <CardContent className="p-0">
                  {r.actions.length === 0 ? (
                    <p className="px-4 pb-3 text-2xs text-muted">
                      This run recorded no actions — it considered its options and did nothing.
                    </p>
                  ) : (
                    <ol className="divide-y divide-border-subtle border-t border-border-subtle">
                      {r.actions.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-baseline gap-1.5 px-4 py-2">
                          <span className="w-4 shrink-0 text-2xs tabular text-muted">
                            {a.sequence}
                          </span>
                          <Badge variant={RISK_VARIANT[a.riskClass] ?? "neutral"} size="sm">
                            {a.riskClass}
                          </Badge>
                          <span
                            className={cn(
                              "text-2xs font-medium",
                              a.state === "completed" || a.state === "executed"
                                ? "text-success-text"
                                : a.state === "refused"
                                  ? "text-danger-text"
                                  : a.state === "deferred"
                                    ? "text-muted"
                                    : "text-warning-text"
                            )}
                          >
                            {a.state.replace(/_/g, " ")}
                          </span>
                          <span className="min-w-0 flex-1 text-xs text-primary">{a.summary}</span>
                          <span className="font-mono text-2xs text-muted">{a.tool}</span>
                          {a.pointsSpent > 0 ? (
                            <span className="text-2xs text-warning-text">
                              {a.pointsSpent}p
                            </span>
                          ) : null}
                          {!a.executable ? (
                            <Tooltip content="This tool is not built, so nothing could have happened here.">
                              <span className="cursor-help text-2xs text-muted">
                                <Info className="inline size-2.5" />
                              </span>
                            </Tooltip>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="border-t border-border-subtle px-4 py-2">
                    <Link
                      href="/approvals"
                      className="text-2xs text-accent-text hover:underline"
                    >
                      {r.actionsHeld > 0
                        ? `${r.actionsHeld} from this run waited on a person →`
                        : "Approval Center →"}
                    </Link>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-2xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular text-primary">{value}</p>
      <p className="text-2xs text-muted">{hint}</p>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-2xs uppercase tracking-wider text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-primary focus:border-accent focus:outline-none"
      >
        {options.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
