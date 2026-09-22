"use client";

import { AlertTriangle, Info, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { formatInrCompact, formatNumber } from "@/lib/format";

type Row = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  leads: number;
  contacted: number;
  replied: number;
  replyRate: number | null;
  activities: number;
  deals: number;
  wonCount: number;
  wonInr: number;
  tasksOpen: number;
  tasksOverdue: number;
  busyNotConverting: boolean;
};

export function TeamView({
  team,
}: {
  team: {
    windowDays: number;
    rows: Row[];
    teamSize: number;
    activeCount: number;
    busyNotConvertingThreshold: { minContacted: number; maxReplyRate: number };
  };
}) {
  const flagged = team.rows.filter((r) => r.busyNotConverting);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Team</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Activity and conversion side by side, because either alone misleads: high activity
          reads as productivity, and a high reply rate on three sends reads as skill.
        </p>
      </div>

      {flagged.length > 0 ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>
            {flagged.map((r) => r.name).join(", ")}{" "}
            {flagged.length === 1 ? "is" : "are"} busy but not converting
          </strong>{" "}
          — at least {team.busyNotConvertingThreshold.minContacted} contacted and under{" "}
          {team.busyNotConvertingThreshold.maxReplyRate}% replying. That is usually a message
          problem rather than an effort one.
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Team" value={formatNumber(team.teamSize)} hint="members" />
        <Stat
          label="Active"
          value={formatNumber(team.activeCount)}
          hint={`in the last ${team.windowDays} days`}
        />
        <Stat
          label="Won"
          value={formatInrCompact(team.rows.reduce((n, r) => n + r.wonInr, 0))}
          hint={`in the last ${team.windowDays} days`}
        />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>By person</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              Last {team.windowDays} days. Lead and task counts are current totals.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {team.rows.length === 0 ? (
            <EmptyState icon={Users} title="Nobody here yet" description="Invite the team." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">Team activity and conversion</caption>
                <thead className="bg-surface-sunken">
                  <tr className="border-y border-border">
                    {[
                      ["Person", "left"],
                      ["Leads", "right"],
                      ["Contacted", "right"],
                      ["Replied", "right"],
                      ["Actions", "right"],
                      ["Tasks", "right"],
                      ["Won", "right"],
                    ].map(([label, align], i) => (
                      <th
                        key={i}
                        scope="col"
                        className={cn(
                          "whitespace-nowrap px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted",
                          align === "right" ? "text-right" : "text-left"
                        )}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {team.rows.map((r) => (
                    <tr key={r.userId} className="border-b border-border-subtle last:border-0">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar name={r.name} src={r.avatarUrl ?? undefined} size="sm" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-primary">{r.name}</span>
                              {r.busyNotConverting ? (
                                <Tooltip
                                  content={`At least ${team.busyNotConvertingThreshold.minContacted} contacted and under ${team.busyNotConvertingThreshold.maxReplyRate}% replying.`}
                                >
                                  <span className="cursor-help">
                                    <Badge variant="warning" size="sm">
                                      Busy, not converting
                                    </Badge>
                                  </span>
                                </Tooltip>
                              ) : null}
                            </div>
                            <p className="text-2xs text-muted">{r.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular text-secondary">
                        {formatNumber(r.leads)}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-secondary">
                        {r.contacted > 0 ? formatNumber(r.contacted) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular">
                        <span className="text-secondary">{r.replied}</span>
                        {r.replyRate !== null ? (
                          <Tooltip content={`${r.replied} of ${r.contacted} contacted`}>
                            <span
                              className={cn(
                                "ml-1 cursor-help text-2xs",
                                r.replyRate >= 15
                                  ? "text-success-text"
                                  : r.replyRate >= 5
                                    ? "text-muted"
                                    : "text-danger-text"
                              )}
                            >
                              {r.replyRate}%
                            </span>
                          </Tooltip>
                        ) : (
                          <Tooltip content="Nobody contacted yet, so there is no rate to report.">
                            <span className="ml-1 cursor-help text-2xs text-muted">
                              not measured
                            </span>
                          </Tooltip>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-secondary">
                        {r.activities > 0 ? formatNumber(r.activities) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular text-secondary">
                        {r.tasksOpen}
                        {r.tasksOverdue > 0 ? (
                          <Tooltip content={`${r.tasksOverdue} past their due date`}>
                            <span className="ml-1 cursor-help text-2xs text-danger-text">
                              {r.tasksOverdue} late
                            </span>
                          </Tooltip>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular font-medium text-success-text">
                        {r.wonInr > 0 ? formatInrCompact(r.wonInr) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-2xs text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        A reply rate reads &ldquo;not measured&rdquo; rather than 0% when nobody has been
        contacted — those are different facts.
      </p>
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
