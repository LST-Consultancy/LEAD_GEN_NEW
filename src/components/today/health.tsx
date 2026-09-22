"use client";

import * as React from "react";
import { ChevronDown, Info } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Dimension = { key: string; label: string; value: number; weight: number; explain: string };

type Health = {
  score: number;
  band: string;
  dimensions: Dimension[];
  weakest: { label: string; value: number; explain: string }[];
};

/**
 * §10 — the score is a hero number, but never a bare one. Every dimension, its
 * weight and the sentence that produced it are one click away.
 */
export function SalesHealth({ health }: { health: Health }) {
  const [open, setOpen] = React.useState(false);

  const bandTone =
    health.score >= 80
      ? { text: "text-success-text", ring: "stroke-success", chip: "bg-success-subtle text-success-text border-success-border" }
      : health.score >= 60
        ? { text: "text-brand-text", ring: "stroke-brand", chip: "bg-brand-subtle text-brand-text border-brand-border" }
        : health.score >= 40
          ? { text: "text-warning-text", ring: "stroke-warning", chip: "bg-warning-subtle text-warning-text border-warning-border" }
          : { text: "text-danger-text", ring: "stroke-danger", chip: "bg-danger-subtle text-danger-text border-danger-border" };

  const r = 34;
  const circumference = 2 * Math.PI * r;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Sales health</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">Ten weighted dimensions, each explained</p>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0" style={{ width: 80, height: 80 }}>
            <svg width={80} height={80} className="-rotate-90" aria-hidden>
              <circle cx={40} cy={40} r={r} fill="none" strokeWidth={6} className="stroke-border" />
              <circle
                cx={40}
                cy={40}
                r={r}
                fill="none"
                strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - health.score / 100)}
                className={cn(bandTone.ring, "transition-[stroke-dashoffset] duration-700 ease-out")}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn("text-2xl font-semibold tabular", bandTone.text)}>{health.score}</span>
              <span className="text-2xs text-muted">/ 100</span>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <span
              className={cn(
                "inline-flex items-center rounded border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide",
                bandTone.chip
              )}
            >
              {health.band}
            </span>
            <ul className="mt-2 space-y-1">
              {health.weakest.map((w) => (
                <li key={w.label} className="text-2xs leading-relaxed text-secondary">
                  <span className="font-medium text-primary">{w.label}</span>{" "}
                  <span className="text-muted tabular">({w.value})</span> — {w.explain}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="flex items-center gap-1.5">
            <Info className="size-3.5" />
            {open ? "Hide" : "Show"} all ten dimensions
          </span>
          <ChevronDown className={cn("size-3.5 transition-transform duration-150", open && "rotate-180")} />
        </Button>

        {open ? (
          <div className="space-y-2 rounded-md border border-border-subtle bg-surface-sunken p-3 animate-in-up">
            {health.dimensions.map((d) => (
              <div key={d.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                    {d.label}
                    <Tooltip content={`Contributes ${d.weight}% of the composite score`}>
                      <span className="cursor-help text-2xs font-normal text-muted">{d.weight}%</span>
                    </Tooltip>
                  </span>
                  <span
                    className={cn(
                      "text-xs font-semibold tabular",
                      d.value >= 70 ? "text-success-text" : d.value >= 45 ? "text-secondary" : "text-danger-text"
                    )}
                  >
                    {d.value}
                  </span>
                </div>
                <Progress
                  value={d.value}
                  size="xs"
                  label={`${d.label}: ${d.value} of 100`}
                  barClassName={
                    d.value >= 70 ? "bg-success" : d.value >= 45 ? "bg-brand" : "bg-warning"
                  }
                />
                <p className="text-2xs leading-relaxed text-muted">{d.explain}</p>
              </div>
            ))}
            <p className="border-t border-border pt-2 text-2xs leading-relaxed text-muted">
              The composite is a weighted mean of the values above. Weights are configurable per
              workspace — nothing here is a fixed industry benchmark.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
