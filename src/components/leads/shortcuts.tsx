"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

type Shortcut = { key: string; label: string; hint: string };

/**
 * §18 — named presets with live counts. A count of zero is shown rather than
 * hidden, because "nothing matches this right now" is information.
 */
export function SmartShortcuts({
  shortcuts,
  counts,
  active,
  onSelect,
  pending,
}: {
  shortcuts: Shortcut[];
  counts: Record<string, number>;
  active: string | null;
  onSelect: (key: string | null) => void;
  pending?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-1.5 overflow-x-auto pb-1 scrollbar-none transition-opacity",
        pending && "opacity-60"
      )}
      role="group"
      aria-label="Lead shortcuts"
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={active === null}
        className={cn(
          "shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors duration-150",
          active === null
            ? "border-brand-border bg-brand-subtle text-brand-text"
            : "border-border bg-surface text-secondary hover:border-border-strong hover:text-primary"
        )}
      >
        All leads
      </button>

      {shortcuts.map((s) => {
        const count = counts[s.key] ?? 0;
        const isActive = active === s.key;
        return (
          <Tooltip key={s.key} content={s.hint}>
            <button
              type="button"
              onClick={() => onSelect(isActive ? null : s.key)}
              aria-pressed={isActive}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors duration-150",
                isActive
                  ? "border-brand-border bg-brand-subtle text-brand-text"
                  : count === 0
                    ? "border-border-subtle bg-surface text-muted hover:border-border"
                    : "border-border bg-surface text-secondary hover:border-border-strong hover:text-primary"
              )}
            >
              {s.label}
              <span
                className={cn(
                  "rounded px-1 text-2xs font-semibold tabular",
                  isActive
                    ? "bg-brand text-brand-fg"
                    : count === 0
                      ? "bg-surface-sunken text-muted"
                      : "bg-surface-sunken text-secondary"
                )}
              >
                {count}
              </span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
