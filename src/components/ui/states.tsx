"use client";

import * as React from "react";
import { AlertTriangle, Info, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * §97 — empty states teach. Every one names what is missing, why, and the one
 * action that fixes it.
 */
export function EmptyState({
  icon: Icon = Info,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-border-subtle bg-surface-sunken text-muted",
          compact ? "size-8" : "size-11"
        )}
      >
        <Icon className={compact ? "size-4" : "size-5"} />
      </div>
      <div className="space-y-1">
        <p className={cn("font-semibold text-primary", compact ? "text-xs" : "text-sm")}>{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-secondary">{description}</p>
        ) : null}
      </div>
      {action || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

/**
 * §127 — errors speak human and, where money is involved, state the financial
 * consequence explicitly.
 */
export function ErrorState({
  title = "We couldn't load this",
  description,
  onRetry,
  retryLabel = "Try again",
  className,
  compact,
  offline,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
  offline?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-danger-border bg-danger-subtle text-danger-text",
          compact ? "size-8" : "size-11"
        )}
      >
        {offline ? (
          <WifiOff className={compact ? "size-4" : "size-5"} />
        ) : (
          <AlertTriangle className={compact ? "size-4" : "size-5"} />
        )}
      </div>
      <div className="space-y-1">
        <p className={cn("font-semibold text-primary", compact ? "text-xs" : "text-sm")}>{title}</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-secondary">
          {description ??
            "Something went wrong on our side. Nothing was changed and no points were charged."}
        </p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RefreshCw />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * §96 — partial errors. When one panel of a composite screen fails we say which
 * part is stale rather than blanking the whole page.
 */
export function PartialErrorBanner({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-xs text-warning-text",
        className
      )}
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Honest placeholder for routes whose backend is not built yet (§126). */
export function NotBuiltYet({
  feature,
  phase,
  description,
  planned,
}: {
  feature: string;
  phase: string;
  description: string;
  planned?: string[];
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <div className="rounded-xl border border-dashed border-border-strong bg-surface p-6 sm:p-8">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded border border-border bg-surface-sunken px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider text-muted">
          Not built yet · {phase}
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-primary">{feature}</h2>
        <p className="mt-2 text-sm leading-relaxed text-secondary">{description}</p>
        {planned?.length ? (
          <>
            <p className="mt-5 text-2xs font-semibold uppercase tracking-wider text-muted">
              Planned scope
            </p>
            <ul className="mt-2 space-y-1.5">
              {planned.map((item) => (
                <li key={item} className="flex gap-2 text-xs text-secondary">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-border-strong" />
                  {item}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="mt-6 border-t border-border-subtle pt-4 text-xs text-muted">
          This screen is deliberately inert. It shows no placeholder metrics, because a number you
          can&apos;t trace to evidence is worse than no number.
        </p>
      </div>
    </div>
  );
}
