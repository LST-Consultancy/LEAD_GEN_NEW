"use client";

import { Info, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatInrCompact, formatNumber } from "@/lib/format";

type Funnel = {
  windowDays: number;
  wonInr: number;
  lostCount: number;
  lostInr: number;
  caveat: string;
  stages: {
    key: string;
    label: string;
    count: number;
    fromPrevious: number | null;
    previousLabel: string | null;
    previousCount: number | null;
  }[];
};

type Attribution = {
  rows: {
    key: string;
    label: string;
    leads: number;
    tierA: number;
    replied: number;
    replyRate: number | null;
    deals: number;
    openInr: number;
    wonInr: number;
    wonCount: number;
    revenuePerLead: number;
  }[];
  totalLeads: number;
  unattributedLeads: number;
  unattributedWonInr: number;
  attributionCoverage: number | null;
};

export function InsightsView({
  funnel,
  attribution,
}: {
  funnel: Funnel;
  attribution: Attribution;
}) {
  const top = Math.max(1, ...funnel.stages.map((s) => s.count));
  const biggestDrop = funnel.stages
    .filter((s) => s.fromPrevious !== null)
    .sort((a, b) => (a.fromPrevious ?? 100) - (b.fromPrevious ?? 100))[0];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Insights</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          The funnel from signal to revenue, and which sources actually produce money. Every
          ratio names both of its terms, because a conversion rate without its denominator is the
          easiest number here to misread.
        </p>
      </div>

      {biggestDrop && biggestDrop.fromPrevious !== null && biggestDrop.fromPrevious < 40 ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-text">
          <TrendingDown className="mr-1 inline size-3.5" />
          The narrowest step is <strong>{biggestDrop.previousLabel} → {biggestDrop.label}</strong>:{" "}
          {formatNumber(biggestDrop.count)} of {formatNumber(biggestDrop.previousCount ?? 0)} (
          {biggestDrop.fromPrevious}%). That is where the most is lost.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Signal to revenue</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">Last {funnel.windowDays} days.</p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {funnel.stages.map((s) => (
            <div key={s.key}>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-primary">{s.label}</span>
                <span className="text-xs tabular text-secondary">
                  {formatNumber(s.count)}
                  {s.fromPrevious !== null ? (
                    <Tooltip
                      content={`${formatNumber(s.count)} of ${formatNumber(s.previousCount ?? 0)} ${s.previousLabel?.toLowerCase()}`}
                    >
                      <span
                        className={cn(
                          "ml-2 cursor-help text-2xs",
                          s.fromPrevious < 25
                            ? "text-danger-text"
                            : s.fromPrevious < 50
                              ? "text-warning-text"
                              : "text-muted"
                        )}
                      >
                        {s.fromPrevious}% of {s.previousLabel?.toLowerCase()}
                      </span>
                    </Tooltip>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(1, (s.count / top) * 100)}%` }}
                  aria-hidden
                />
              </div>
            </div>
          ))}

          <div className="mt-1 flex flex-wrap gap-4 border-t border-border-subtle pt-2">
            <div>
              <p className="text-2xs uppercase tracking-wider text-muted">Won</p>
              <p className="text-sm font-semibold tabular text-success-text">
                {formatInrCompact(funnel.wonInr)}
              </p>
            </div>
            <div>
              <p className="text-2xs uppercase tracking-wider text-muted">Lost</p>
              <p className="text-sm font-semibold tabular text-secondary">
                {formatInrCompact(funnel.lostInr)}
                <span className="ml-1 text-2xs font-normal text-muted">
                  {funnel.lostCount} deals
                </span>
              </p>
            </div>
          </div>

          <p className="text-2xs text-muted">
            <Info className="mr-0.5 inline size-2.5" />
            {funnel.caveat}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Where revenue comes from</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {attribution.attributionCoverage !== null
                ? `${attribution.attributionCoverage}% of leads have a recorded source.`
                : "No leads yet."}{" "}
              Sorted by money, not volume.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {attribution.unattributedLeads > 0 ? (
            <p className="px-4 pb-2 text-2xs text-warning-text">
              <Info className="mr-0.5 inline size-2.5" />
              {formatNumber(attribution.unattributedLeads)} of{" "}
              {formatNumber(attribution.totalLeads)} leads have no recorded source
              {attribution.unattributedWonInr > 0
                ? `, carrying ${formatInrCompact(attribution.unattributedWonInr)} of won revenue`
                : ""}
              . They are shown as their own row rather than hidden — not knowing where revenue
              came from is itself the finding.
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Revenue by source</caption>
              <thead className="bg-surface-sunken">
                <tr className="border-y border-border">
                  {[
                    ["Source", "left"],
                    ["Leads", "right"],
                    ["Tier A", "right"],
                    ["Replied", "right"],
                    ["Deals", "right"],
                    ["Open", "right"],
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
                {attribution.rows.map((r) => (
                  <tr
                    key={r.key}
                    className={cn(
                      "border-b border-border-subtle last:border-0",
                      r.key === "__unattributed" && "bg-surface-sunken/50"
                    )}
                  >
                    <td className="px-3 py-2 text-primary">{r.label}</td>
                    <td className="px-3 py-2 text-right tabular text-secondary">
                      {formatNumber(r.leads)}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-secondary">
                      {r.tierA > 0 ? r.tierA : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular text-secondary">
                      {r.replied}
                      {r.replyRate !== null ? (
                        <span className="ml-1 text-2xs text-muted">{r.replyRate}%</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-secondary">
                      {r.deals > 0 ? r.deals : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-secondary">
                      {r.openInr > 0 ? formatInrCompact(r.openInr) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular font-medium text-success-text">
                      {r.wonInr > 0 ? formatInrCompact(r.wonInr) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
