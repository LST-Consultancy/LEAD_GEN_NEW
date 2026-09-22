"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { clamp } from "@/lib/utils";

export function Progress({
  value,
  max = 100,
  className,
  barClassName,
  size = "md",
  label,
}: {
  value: number;
  max?: number;
  className?: string;
  barClassName?: string;
  size?: "xs" | "sm" | "md";
  label?: string;
}) {
  const pct = clamp((value / max) * 100, 0, 100);
  const heights = { xs: "h-1", sm: "h-1.5", md: "h-2" };
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={cn("w-full overflow-hidden rounded-full bg-surface-sunken", heights[size], className)}
    >
      <div
        className={cn("h-full rounded-full bg-brand transition-[width] duration-300 ease-out", barClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Segmented meter used for score dimensions — reads faster than a bar. */
export function SegmentMeter({
  value,
  max = 100,
  segments = 10,
  className,
  tone = "brand",
}: {
  value: number;
  max?: number;
  segments?: number;
  className?: string;
  tone?: "brand" | "success" | "warning" | "danger" | "hot";
}) {
  const filled = Math.round(clamp((value / max) * segments, 0, segments));
  const tones = {
    brand: "bg-brand",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    hot: "bg-intent-hot",
  };
  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      role="img"
      aria-label={`${Math.round(value)} out of ${max}`}
    >
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-2.5 w-1 rounded-[1px] transition-colors duration-200",
            i < filled ? tones[tone] : "bg-border"
          )}
        />
      ))}
    </div>
  );
}
