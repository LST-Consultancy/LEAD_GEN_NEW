"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Multi-value editor for the list fields an ICP is made of.
 *
 * Suggestions come from what already exists in the workspace, so a user is
 * nudged toward values that will actually match rather than typing a variant
 * that silently matches nothing.
 */
export function TagInput({
  label,
  hint,
  values,
  onChange,
  suggestions = [],
  placeholder,
  tone = "neutral",
  max = 50,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  tone?: "neutral" | "danger";
  max?: number;
}) {
  const [draft, setDraft] = React.useState("");
  const inputId = React.useId();

  const unused = suggestions.filter(
    (s) => !values.some((v) => v.toLowerCase() === s.toLowerCase())
  );

  function add(value: string) {
    const clean = value.trim();
    if (!clean) return;
    if (values.some((v) => v.toLowerCase() === clean.toLowerCase())) {
      setDraft("");
      return;
    }
    if (values.length >= max) return;
    onChange([...values, clean]);
    setDraft("");
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  return (
    <fieldset className="space-y-1.5">
      <Label htmlFor={inputId}>
        {label}
        {values.length > 0 ? (
          <span className="ml-1 font-normal text-muted tabular">({values.length})</span>
        ) : null}
      </Label>

      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {values.map((value) => (
            <span
              key={value}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs",
                tone === "danger"
                  ? "border-danger-border bg-danger-subtle text-danger-text"
                  : "border-brand-border bg-brand-subtle text-brand-text"
              )}
            >
              {value}
              <button
                type="button"
                onClick={() => remove(value)}
                aria-label={`Remove ${value}`}
                className="rounded transition-opacity hover:opacity-70"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex gap-1.5">
        <Input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            }
            if (e.key === "Backspace" && !draft && values.length > 0) {
              remove(values[values.length - 1]);
            }
          }}
          placeholder={placeholder ?? "Type and press Enter"}
          className="h-7"
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
          aria-label={`Add to ${label}`}
          className="shrink-0 rounded-md border border-border px-2 text-muted transition-colors hover:border-border-strong hover:text-primary disabled:opacity-40"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {unused.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-2xs text-muted">In your data:</span>
          {unused.slice(0, 10).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded border border-border-subtle bg-surface-sunken px-1.5 py-0.5 text-2xs text-secondary transition-colors hover:border-border-strong hover:text-primary"
            >
              + {s}
            </button>
          ))}
          {unused.length > 10 ? (
            <Tooltip content={unused.slice(10).join(", ")}>
              <span className="cursor-help text-2xs text-muted">+{unused.length - 10} more</span>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      {hint ? <p className="text-2xs leading-relaxed text-muted">{hint}</p> : null}
    </fieldset>
  );
}
