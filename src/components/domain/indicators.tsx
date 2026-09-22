"use client";

import * as React from "react";
import { Lock, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  INTENT,
  INTENT_ORDER,
  LEAD_STATUS,
  TIER,
  VERIFICATION,
  verificationMeaning,
  type IntentKey,
  type LeadStatusKey,
  type TierKey,
} from "@/lib/vocab";

export function TierBadge({
  tier,
  size = "md",
  withTooltip = true,
}: {
  tier: TierKey;
  size?: "sm" | "md" | "lg";
  withTooltip?: boolean;
}) {
  const meta = TIER[tier];
  const dims = { sm: "size-4 text-2xs", md: "size-5 text-2xs", lg: "size-6 text-xs" };
  const chip = (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded border font-bold tabular",
        dims[size],
        meta.chip
      )}
    >
      {meta.label}
    </span>
  );
  if (!withTooltip) return chip;
  return (
    <Tooltip content={<><strong>Tier {tier}</strong> — {meta.meaning}</>}>
      <span className="inline-flex">{chip}</span>
    </Tooltip>
  );
}

export function IntentBadge({
  intent,
  size = "md",
  showDot = true,
}: {
  intent: IntentKey;
  size?: "sm" | "md" | "lg";
  showDot?: boolean;
}) {
  const meta = INTENT[intent];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border font-medium uppercase tracking-wide",
        size === "sm" ? "h-4 px-1 text-2xs" : size === "lg" ? "h-6 px-2 text-xs" : "h-5 px-1.5 text-2xs",
        meta.chip
      )}
    >
      {showDot ? <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} /> : null}
      {meta.label}
    </span>
  );
}

/** §23 — the Cold → Buying ladder, shown as a filled track. */
export function DealTemperature({
  intent,
  className,
  showLabels = true,
}: {
  intent: IntentKey;
  className?: string;
  showLabels?: boolean;
}) {
  const current = INTENT[intent].order;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1" role="img" aria-label={`Deal temperature: ${INTENT[intent].label}`}>
        {INTENT_ORDER.map((key, i) => {
          const active = i <= current;
          return (
            <div
              key={key}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors duration-300",
                active ? INTENT[intent].dot : "bg-border"
              )}
            />
          );
        })}
      </div>
      {showLabels ? (
        <div className="flex items-center justify-between">
          {INTENT_ORDER.map((key, i) => (
            <span
              key={key}
              className={cn(
                "text-2xs transition-colors",
                i === current ? cn("font-semibold", INTENT[key].text) : "text-muted"
              )}
            >
              {INTENT[key].label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LeadStatusBadge({ status }: { status: LeadStatusKey }) {
  const meta = LEAD_STATUS[status];
  return (
    <Badge variant={meta.variant} uppercase>
      {meta.label}
    </Badge>
  );
}

export function VerificationBadge({
  status,
  kind = "WORK_EMAIL",
  verifiedAt,
}: {
  status: string;
  /** The channel decides what "verified" actually means — see verificationMeaning. */
  kind?: string;
  verifiedAt?: string | null;
}) {
  const meta = VERIFICATION[status] ?? VERIFICATION.UNVERIFIED;
  return (
    <Tooltip
      content={
        <>
          <strong>{meta.label}</strong> — {verificationMeaning(status, kind)}
          {verifiedAt && status === "VERIFIED" ? (
            <div className="mt-1 text-muted">
              Checked {new Date(verifiedAt).toLocaleDateString("en-IN")}
            </div>
          ) : null}
        </>
      }
    >
      <Badge variant={meta.variant} className="cursor-help">
        {status === "VERIFIED" ? <ShieldCheck /> : null}
        {meta.label}
      </Badge>
    </Tooltip>
  );
}

export function LockedBadge({ cost }: { cost?: number }) {
  return (
    <Tooltip
      content={
        cost
          ? `Locked. Revealing verified contacts costs ${cost} ${cost === 1 ? "point" : "points"}.`
          : "Locked until you reveal this contact."
      }
    >
      <Badge variant="neutral" className="cursor-help font-mono">
        <Lock />
        Locked
      </Badge>
    </Tooltip>
  );
}

export function AiBadge({ label = "AI", tooltip }: { label?: string; tooltip?: string }) {
  const chip = (
    <Badge variant="ai" uppercase>
      <Sparkles />
      {label}
    </Badge>
  );
  return tooltip ? <Tooltip content={tooltip}>{chip}</Tooltip> : chip;
}

/**
 * The /10 score. Always paired with a "why" affordance — §72 forbids an opaque
 * number, so this never renders alone in a clickable context.
 */
export function ScoreDial({
  score,
  size = "md",
  className,
}: {
  score: number;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(10, score)) / 10;
  const dims = {
    sm: { box: 28, stroke: 3, text: "text-2xs" },
    md: { box: 36, stroke: 3.5, text: "text-xs" },
    lg: { box: 48, stroke: 4, text: "text-sm" },
    xl: { box: 64, stroke: 5, text: "text-lg" },
  }[size];
  const r = (dims.box - dims.stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const tone =
    score >= 8 ? "stroke-success" : score >= 6 ? "stroke-brand" : score >= 4 ? "stroke-warning" : "stroke-border-strong";
  const textTone =
    score >= 8 ? "text-success-text" : score >= 6 ? "text-brand-text" : score >= 4 ? "text-warning-text" : "text-muted";

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: dims.box, height: dims.box }}
      role="img"
      aria-label={`Score ${score.toFixed(1)} out of 10`}
    >
      <svg width={dims.box} height={dims.box} className="-rotate-90">
        <circle
          cx={dims.box / 2}
          cy={dims.box / 2}
          r={r}
          fill="none"
          strokeWidth={dims.stroke}
          className="stroke-border"
        />
        <circle
          cx={dims.box / 2}
          cy={dims.box / 2}
          r={r}
          fill="none"
          strokeWidth={dims.stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className={cn(tone, "transition-[stroke-dashoffset] duration-500 ease-out")}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center font-semibold tabular",
          dims.text,
          textTone
        )}
      >
        {score % 1 === 0 ? score.toFixed(0) : score.toFixed(1)}
      </span>
    </div>
  );
}

/** Compact inline score for table cells. */
export function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 8
      ? "bg-success-subtle text-success-text border-success-border"
      : score >= 6
        ? "bg-brand-subtle text-brand-text border-brand-border"
        : score >= 4
          ? "bg-warning-subtle text-warning-text border-warning-border"
          : "bg-surface-sunken text-muted border-border-subtle";
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-8 items-center justify-center rounded border px-1 text-2xs font-semibold tabular",
        tone
      )}
    >
      {score % 1 === 0 ? score.toFixed(0) : score.toFixed(1)}
    </span>
  );
}
