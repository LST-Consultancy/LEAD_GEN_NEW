"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * A stat tile, not a chart. Most of the numbers on Today are single values whose
 * job is magnitude and comparison, which a tile does better than any plot.
 * Values stay in text tokens; colour only ever appears on a small status mark.
 */
export function Metric({
  label,
  value,
  sub,
  href,
  hint,
  tone = "neutral",
  size = "md",
  delta,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  hint?: React.ReactNode;
  tone?: "neutral" | "good" | "warning" | "serious" | "brand";
  size?: "sm" | "md" | "lg" | "hero";
  delta?: { direction: "up" | "down" | "flat"; label: string; isGood?: boolean };
  className?: string;
}) {
  const valueSize = {
    sm: "text-base",
    md: "text-xl",
    lg: "text-2xl",
    hero: "text-4xl sm:text-5xl",
  }[size];

  const mark = {
    neutral: "bg-border-strong",
    good: "bg-success",
    warning: "bg-warning",
    serious: "bg-danger",
    brand: "bg-brand",
  }[tone];

  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <span className={cn("size-1.5 shrink-0 rounded-full", mark)} aria-hidden />
        <span className="truncate text-2xs font-semibold uppercase tracking-wider text-muted">
          {label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("font-semibold tracking-tight text-primary tabular", valueSize)}>
          {value}
        </span>
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-2xs font-medium tabular",
              delta.direction === "flat"
                ? "text-muted"
                : delta.isGood === false
                  ? "text-danger-text"
                  : delta.isGood === true
                    ? "text-success-text"
                    : "text-secondary"
            )}
          >
            {delta.direction === "up" ? (
              <ArrowUpRight className="size-3" />
            ) : delta.direction === "down" ? (
              <ArrowDownRight className="size-3" />
            ) : (
              <Minus className="size-3" />
            )}
            {delta.label}
          </span>
        ) : null}
      </div>
      {sub ? <p className="mt-0.5 truncate text-2xs text-secondary">{sub}</p> : null}
    </>
  );

  const shell = cn(
    "min-w-0 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors duration-150",
    href && "hover:border-border-strong hover:bg-surface-hover",
    className
  );

  const tile = href ? (
    <Link href={href} className={cn(shell, "block")}>
      {body}
      <span className="sr-only"> — open</span>
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );

  return hint ? <Tooltip content={hint}>{tile}</Tooltip> : tile;
}

/** Compact inline key/value row, for dense side panels. */
export function StatRow({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: string;
  tone?: "good" | "warning" | "serious";
  href?: string;
}) {
  const content = (
    <>
      <span className="truncate text-xs text-secondary">{label}</span>
      <span
        className={cn(
          "shrink-0 text-xs font-semibold tabular",
          tone === "good"
            ? "text-success-text"
            : tone === "warning"
              ? "text-warning-text"
              : tone === "serious"
                ? "text-danger-text"
                : "text-primary"
        )}
      >
        {value}
      </span>
    </>
  );
  return href ? (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded px-1 py-1 transition-colors hover:bg-surface-hover"
    >
      {content}
      <ArrowRight className="size-3 shrink-0 text-muted" />
    </Link>
  ) : (
    <div className="flex items-center justify-between gap-3 px-1 py-1">{content}</div>
  );
}
