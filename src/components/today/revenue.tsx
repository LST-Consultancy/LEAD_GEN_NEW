"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Metric } from "@/components/charts/metric";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatInrCompact, formatNumber } from "@/lib/format";

type Revenue = {
  pipelineInr: number;
  weightedInr: number;
  commitInr: number;
  bestCaseInr: number;
  atRiskInr: number;
  watchInr: number;
  watchDealCount: number;
  wonLast30DaysInr: number;
  wonLast30DaysCount: number;
  addedThisWeekInr: number;
  addedThisWeekCount: number;
  movedForwardInr: number;
  movedBackwardInr: number;
  openDealCount: number;
  atRiskDealCount: number;
  closingThisMonthInr: number;
  closingThisMonthCount: number;
};

/** §8 — every figure is clickable and states the assumption behind it. */
export function RevenueInReach({ revenue }: { revenue: Revenue }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Revenue in reach</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            {formatNumber(revenue.openDealCount)} open deals · click any figure to see what it counts
          </p>
        </div>
        <Button variant="ghost" size="xs" asChild>
          <Link href="/pipeline">
            Pipeline
            <ArrowRight />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Metric
            label="Open pipeline"
            value={formatInrCompact(revenue.pipelineInr)}
            sub={`${revenue.openDealCount} deals`}
            href="/pipeline"
            tone="brand"
            size="lg"
            hint="Total value of every open deal, unweighted. The rawest figure here."
          />
          <Metric
            label="Weighted"
            value={formatInrCompact(revenue.weightedInr)}
            sub="by stage probability"
            href="/pipeline"
            size="lg"
            hint="Each deal multiplied by its stage's historical close probability. A statistical estimate, not a prediction about these specific deals."
          />
          <Metric
            label="Commit"
            value={formatInrCompact(revenue.commitInr)}
            sub="late stage, called"
            href="/pipeline"
            tone="good"
            size="lg"
            hint="Deals past 65% stage probability where the owner has set confidence at 70% or above. Deliberately narrower than weighted."
          />
          <Metric
            label="At risk"
            value={formatInrCompact(revenue.atRiskInr)}
            sub={
              revenue.atRiskDealCount === 0
                ? "nothing critical"
                : `${revenue.atRiskDealCount} ${revenue.atRiskDealCount === 1 ? "deal" : "deals"}`
            }
            href="/pipeline"
            tone={revenue.atRiskInr > 0 ? "serious" : "good"}
            size="lg"
            hint="Open deals carrying a HIGH-severity flag — badly overrun on stage time, or silent for over five weeks. Deals merely missing a next step are counted under Watch instead."
          />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border-subtle pt-3 sm:grid-cols-3 lg:grid-cols-5">
          <MiniStat
            label="Added this week"
            value={formatInrCompact(revenue.addedThisWeekInr)}
            detail={`${revenue.addedThisWeekCount} new`}
            tone="good"
          />
          <MiniStat
            label="Moved forward"
            value={formatInrCompact(revenue.movedForwardInr)}
            detail="last 7 days"
            tone="good"
          />
          <MiniStat
            label="Moved backward"
            value={formatInrCompact(revenue.movedBackwardInr)}
            detail="last 7 days"
            tone={revenue.movedBackwardInr > 0 ? "bad" : "flat"}
          />
          <MiniStat
            label="Won (30 days)"
            value={formatInrCompact(revenue.wonLast30DaysInr)}
            detail={`${revenue.wonLast30DaysCount} deals`}
            tone="good"
          />
          <MiniStat
            label="On watch"
            value={formatInrCompact(revenue.watchInr)}
            detail={`${revenue.watchDealCount} need hygiene`}
            tone={revenue.watchDealCount > 0 ? "flat" : "good"}
          />
        </dl>

        {revenue.closingThisMonthCount > 0 ? (
          <p className="flex items-start gap-1.5 rounded-md bg-surface-sunken px-2.5 py-2 text-2xs leading-relaxed text-secondary">
            <Info className="mt-0.5 size-3 shrink-0 text-muted" />
            {revenue.closingThisMonthCount} {revenue.closingThisMonthCount === 1 ? "deal is" : "deals are"} due
            to close in the next 30 days, worth {formatInrCompact(revenue.closingThisMonthInr)}. Expected
            close dates are entered by deal owners, not inferred.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "bad" | "flat";
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-2xs uppercase tracking-wider text-muted">{label}</dt>
      <dd
        className={cn(
          "text-sm font-semibold tabular",
          tone === "good" ? "text-success-text" : tone === "bad" ? "text-danger-text" : "text-secondary"
        )}
      >
        {value}
        <span className="ml-1 text-2xs font-normal text-muted">{detail}</span>
      </dd>
    </div>
  );
}

type Motion = {
  days: number;
  entered: { inr: number; count: number };
  advanced: { inr: number; count: number };
  stalled: { inr: number; count: number };
  regressed: { inr: number; count: number };
  won: { inr: number; count: number };
  lost: { inr: number; count: number };
};

const PERIODS = [
  { days: 1, label: "Today" },
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
  { days: 90, label: "Quarter" },
];

/**
 * §11 — six pipeline states. These are status, not categories, so they use the
 * reserved status tokens with an icon-free but labelled mark, never the
 * categorical series hues.
 */
export function RevenueInMotion({
  motion,
  onPeriodChange,
  pending,
}: {
  motion: Motion;
  onPeriodChange?: (days: number) => void;
  pending?: boolean;
}) {
  const states: {
    key: keyof Omit<Motion, "days">;
    label: string;
    tone: "good" | "warning" | "serious" | "neutral";
    meaning: string;
  }[] = [
    { key: "entered", label: "Entered pipeline", tone: "neutral", meaning: "Deals created in this window." },
    { key: "advanced", label: "Advanced", tone: "good", meaning: "Moved to a later stage." },
    { key: "won", label: "Closed won", tone: "good", meaning: "Reached a winning stage." },
    { key: "stalled", label: "Stalled", tone: "warning", meaning: "Past the normal dwell time for their stage." },
    { key: "regressed", label: "Regressed", tone: "serious", meaning: "Moved back to an earlier stage." },
    { key: "lost", label: "Closed lost", tone: "serious", meaning: "Reached a losing stage." },
  ];

  const marks = {
    good: "bg-success",
    warning: "bg-warning",
    serious: "bg-danger",
    neutral: "bg-border-strong",
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Revenue in motion</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">Where money actually moved</p>
        </div>
        <div
          className="flex items-center gap-0.5 rounded-md border border-border bg-surface-sunken p-0.5"
          role="group"
          aria-label="Time period"
        >
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => onPeriodChange?.(p.days)}
              aria-pressed={motion.days === p.days}
              className={cn(
                "rounded px-1.5 py-0.5 text-2xs font-medium transition-colors",
                motion.days === p.days
                  ? "bg-surface text-primary shadow-card"
                  : "text-muted hover:text-secondary"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent>
        <div className={cn("space-y-0.5 transition-opacity", pending && "opacity-50")}>
          {states.map((s) => {
            const data = motion[s.key];
            return (
              <Tooltip key={s.key} content={s.meaning}>
                <div className="flex items-center gap-2 rounded px-1 py-1.5 transition-colors hover:bg-surface-hover">
                  <span className={cn("size-1.5 shrink-0 rounded-full", marks[s.tone])} aria-hidden />
                  <span className="flex-1 truncate text-xs text-secondary">{s.label}</span>
                  <span className="shrink-0 text-2xs text-muted tabular">
                    {data.count} {data.count === 1 ? "deal" : "deals"}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs font-semibold text-primary tabular">
                    {data.inr > 0 ? formatInrCompact(data.inr) : "—"}
                  </span>
                </div>
              </Tooltip>
            );
          })}
        </div>
        <p className="mt-2 border-t border-border-subtle pt-2 text-2xs text-muted">
          Stalled is a current state, not a movement — it overlaps with the others by design.
        </p>
      </CardContent>
    </Card>
  );
}
