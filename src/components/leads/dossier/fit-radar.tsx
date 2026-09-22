"use client";

import * as React from "react";
import { Table2, Radar as RadarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type RadarDimension = {
  key: string;
  label: string;
  question: string;
  value: number;
  evidence: { points: number; label: string; detail: string | null }[];
};

/**
 * §24 — a single-series radar over six inspectable axes. One series means no
 * legend box is needed; the title names it. Every vertex is hoverable and the
 * whole chart has a table view, so nothing here is encoded by shape alone.
 */
export function FitRadar({
  dimensions,
  onSelect,
  selected,
}: {
  dimensions: RadarDimension[];
  onSelect?: (key: string) => void;
  selected?: string | null;
}) {
  const [view, setView] = React.useState<"radar" | "table">("radar");

  // Six axes reads cleanly; more than that and the polygon becomes mush.
  const axes = dimensions.slice(0, 6);
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 82;
  const rings = [0.25, 0.5, 0.75, 1];

  const point = (i: number, ratio: number) => {
    // Start at 12 o'clock and go clockwise.
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * maxR * ratio,
      y: cy + Math.sin(angle) * maxR * ratio,
    };
  };

  const polygon = axes
    .map((d, i) => {
      const p = point(i, Math.max(0.02, d.value / 100));
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(" ");

  if (view === "table") {
    return (
      <div className="space-y-2">
        <ViewToggle view={view} setView={setView} />
        <table className="w-full text-xs">
          <caption className="sr-only">Fit dimensions and their scores out of 100</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted">
                Dimension
              </th>
              <th scope="col" className="py-1.5 text-right text-2xs font-semibold uppercase tracking-wider text-muted">
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {axes.map((d) => (
              <tr key={d.key} className="border-b border-border-subtle last:border-0">
                <th scope="row" className="py-1.5 text-left font-medium text-secondary">
                  {d.label}
                  <span className="block text-2xs font-normal text-muted">{d.question}</span>
                </th>
                <td className="py-1.5 text-right font-semibold text-primary tabular">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ViewToggle view={view} setView={setView} />

      <div className="flex justify-center">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Fit radar: ${axes.map((d) => `${d.label} ${d.value}`).join(", ")}`}
          className="overflow-visible"
        >
          {/* Recessive grid */}
          {rings.map((r) => (
            <polygon
              key={r}
              points={axes
                .map((_, i) => {
                  const p = point(i, r);
                  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                })
                .join(" ")}
              fill="none"
              className="stroke-chart-grid"
              strokeWidth={1}
            />
          ))}

          {/* Spokes */}
          {axes.map((_, i) => {
            const p = point(i, 1);
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={p.x}
                y2={p.y}
                className="stroke-chart-grid"
                strokeWidth={1}
              />
            );
          })}

          {/* The series: 2px stroke, translucent fill */}
          <polygon
            points={polygon}
            className="fill-chart-1/20 stroke-chart-1 transition-all duration-500 ease-out"
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* Vertices — >=8px hit targets, with a surface ring so overlaps read */}
          {axes.map((d, i) => {
            const p = point(i, Math.max(0.02, d.value / 100));
            const isSel = selected === d.key;
            return (
              <Tooltip
                key={d.key}
                content={
                  <>
                    <strong>
                      {d.label}: {d.value}/100
                    </strong>
                    <div className="mt-0.5 text-muted">{d.question}</div>
                    {d.evidence.length > 0 ? (
                      <div className="mt-1 text-muted">
                        {d.evidence.length} piece{d.evidence.length === 1 ? "" : "s"} of evidence —
                        click to inspect
                      </div>
                    ) : null}
                  </>
                }
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isSel ? 6 : 4.5}
                  className={cn(
                    "cursor-pointer fill-chart-1 stroke-surface transition-all duration-150",
                    isSel && "fill-brand"
                  )}
                  strokeWidth={2}
                  onClick={() => onSelect?.(d.key)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.label}: ${d.value} out of 100. Inspect evidence.`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect?.(d.key);
                    }
                  }}
                />
              </Tooltip>
            );
          })}

          {/* Direct labels — six axes is few enough to label all of them */}
          {axes.map((d, i) => {
            const p = point(i, 1.26);
            const anchor =
              Math.abs(p.x - cx) < 14 ? "middle" : p.x > cx ? "start" : "end";
            return (
              <g key={d.key}>
                <text
                  x={p.x}
                  y={p.y}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  className="fill-current text-[10px] font-medium text-secondary"
                >
                  {d.label}
                </text>
                <text
                  x={p.x}
                  y={p.y + 11}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  className="fill-current text-[10px] font-semibold text-muted tabular"
                >
                  {d.value}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-center text-2xs text-muted">
        Click any point to see the evidence behind it
      </p>
    </div>
  );
}

function ViewToggle({
  view,
  setView,
}: {
  view: "radar" | "table";
  setView: (v: "radar" | "table") => void;
}) {
  return (
    <div className="flex justify-end">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setView(view === "radar" ? "table" : "radar")}
        aria-label={view === "radar" ? "Show as table" : "Show as radar"}
      >
        {view === "radar" ? <Table2 /> : <RadarIcon />}
      </Button>
    </div>
  );
}
