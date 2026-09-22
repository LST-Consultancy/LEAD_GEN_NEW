"use client";

import * as React from "react";
import { Table2, LayoutGrid } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Row = { key: string; label: string; cells: { date: string; value: number }[] };

/**
 * Sequential encoding: one hue, six steps, light to dark. Magnitude only — no
 * categorical colour here. Every cell has a hover tooltip and the whole thing
 * has a table view, so the information is never colour-only (§107).
 */
const STEPS = [
  "bg-surface-sunken",
  "bg-seq-2",
  "bg-seq-3",
  "bg-seq-4",
  "bg-seq-5",
  "bg-seq-6",
] as const;

function stepFor(value: number, max: number): number {
  if (value === 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.2) return 1;
  if (ratio <= 0.4) return 2;
  if (ratio <= 0.6) return 3;
  if (ratio <= 0.8) return 4;
  return 5;
}

export function ActivityHeatmap({
  rows,
  dates,
  max,
}: {
  rows: Row[];
  dates: string[];
  max: number;
}) {
  const [view, setView] = React.useState<"grid" | "table">("grid");

  const dayLabels = dates.map((d) => {
    const date = new Date(`${d}T00:00:00`);
    return {
      key: d,
      dom: date.getDate(),
      dow: date.toLocaleDateString("en-IN", { weekday: "narrow" }),
      full: date.toLocaleDateString("en-IN", { day: "numeric", month: "short", weekday: "short" }),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      isToday: d === dates[dates.length - 1],
    };
  });

  const totals = rows.map((r) => r.cells.reduce((s, c) => s + c.value, 0));
  const grandTotal = totals.reduce((a, b) => a + b, 0);

  if (grandTotal === 0) {
    return (
      <p className="px-1 py-6 text-center text-xs text-muted">
        No activity recorded in the last {dates.length} days.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs text-muted">
          {grandTotal.toLocaleString("en-IN")} events over {dates.length} days
        </p>
        <div className="flex items-center gap-1">
          <span className="mr-1 flex items-center gap-1 text-2xs text-muted" aria-hidden>
            Less
            {STEPS.map((s, i) => (
              <span key={i} className={cn("size-2 rounded-[2px] border border-border-subtle", s)} />
            ))}
            More
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setView(view === "grid" ? "table" : "grid")}
            aria-label={view === "grid" ? "Show as table" : "Show as grid"}
          >
            {view === "grid" ? <Table2 /> : <LayoutGrid />}
          </Button>
        </div>
      </div>

      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-2xs">
            <caption className="sr-only">Activity counts by type over the last {dates.length} days</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1.5 pr-2 text-left font-semibold text-muted">
                  Activity
                </th>
                {dayLabels.map((d) => (
                  <th key={d.key} scope="col" className="px-1 py-1.5 text-right font-medium text-muted">
                    {d.dom}
                  </th>
                ))}
                <th scope="col" className="pl-2 py-1.5 text-right font-semibold text-muted">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={row.key} className="border-b border-border-subtle last:border-0">
                  <th scope="row" className="py-1 pr-2 text-left font-medium text-secondary">
                    {row.label}
                  </th>
                  {row.cells.map((c) => (
                    <td key={c.date} className="px-1 py-1 text-right text-secondary">
                      {c.value || "—"}
                    </td>
                  ))}
                  <td className="pl-2 py-1 text-right font-semibold text-primary">{totals[ri]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[380px]">
            {/* Day header */}
            <div className="mb-1 flex gap-[3px] pl-[104px]">
              {dayLabels.map((d) => (
                <div
                  key={d.key}
                  className={cn(
                    "flex-1 text-center text-[9px] leading-none",
                    d.isToday ? "font-semibold text-primary" : d.isWeekend ? "text-muted/60" : "text-muted"
                  )}
                >
                  {d.dom}
                </div>
              ))}
            </div>

            <div className="space-y-[3px]">
              {rows.map((row, ri) => (
                <div key={row.key} className="flex items-center gap-[3px]">
                  <div className="w-[101px] shrink-0 truncate pr-1 text-2xs text-secondary">
                    {row.label}
                  </div>
                  {row.cells.map((cell) => {
                    const step = stepFor(cell.value, max);
                    const label = dayLabels.find((d) => d.key === cell.date);
                    return (
                      <Tooltip
                        key={cell.date}
                        content={
                          <>
                            <strong>
                              {cell.value} {row.label.toLowerCase()}
                            </strong>
                            <div className="text-muted">{label?.full}</div>
                          </>
                        }
                      >
                        <div
                          className={cn(
                            "h-4 flex-1 rounded-[2px] border border-border-subtle transition-transform duration-150 hover:scale-[1.18] hover:border-border-strong",
                            STEPS[step]
                          )}
                          role="img"
                          aria-label={`${row.label}, ${label?.full}: ${cell.value}`}
                        />
                      </Tooltip>
                    );
                  })}
                  <div className="w-7 shrink-0 pl-1 text-right text-2xs font-medium text-muted tabular">
                    {totals[ri]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
