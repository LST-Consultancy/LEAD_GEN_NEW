"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Clock,
  Sparkles,
  Star,
} from "lucide-react";
import { Avatar, CompanyAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { IntentBadge, LeadStatusBadge, ScorePill, TierBadge } from "@/components/domain/indicators";
import { ChannelDots } from "@/components/leads/channel-dots";
import { formatAge, formatDate, formatInrCompact, isPast } from "@/lib/format";
import { SIGNAL_TYPE_LABEL, type IntentKey, type LeadStatusKey, type TierKey } from "@/lib/vocab";
import { cn } from "@/lib/utils";

export type LeadRow = {
  id: string;
  status: string;
  tier: string;
  intent: string;
  isStarred: boolean;
  isRevealed: boolean;
  isArchived: boolean;
  score: number;
  isScoreOverridden: boolean;
  person: {
    id: string;
    name: string;
    avatarUrl: string | null;
    linkedinUrl: string | null;
    location: string;
    title: string;
    department: string | null;
    seniority: string | null;
    isDecisionMaker: boolean;
  };
  company: {
    id: string;
    name: string;
    domain: string | null;
    logoUrl: string | null;
    industry: string | null;
    city: string | null;
    employeeCount: number | null;
    intentScore: number;
  };
  channels: {
    email: string;
    phone: string;
    whatsapp: string;
    linkedin: string;
    optedOut: boolean;
  };
  owner: { id: string; name: string; avatarUrl: string | null } | null;
  estimatedBudgetInr: number | null;
  surfacedAt: string;
  surfacedReason: string;
  lastContactedAt: string | null;
  lastActivityAt: string | null;
  repliedAt: string | null;
  nextActionAt: string | null;
  nextActionLabel: string | null;
  deal: { id: string; valueInr: number; stage: string; stageKey: string } | null;
  latestSignal: {
    id: string;
    type: string;
    title: string;
    occurredAt: string;
    confidence: number;
  } | null;
  counts: { signals: number; conversations: number; tasks: number };
};

type SortKey = "score" | "surfaced" | "activity" | "value" | "name" | "company" | "intent";

const COLUMNS: {
  key: string;
  label: string;
  sort?: SortKey;
  className?: string;
  align?: "right" | "center";
}[] = [
  { key: "select", label: "", className: "w-8" },
  { key: "star", label: "", className: "w-7" },
  { key: "lead", label: "Lead", sort: "name", className: "min-w-[200px]" },
  { key: "company", label: "Company", sort: "company", className: "min-w-[170px]" },
  { key: "tier", label: "Tier", className: "w-14", align: "center" },
  { key: "score", label: "Score", sort: "score", className: "w-16", align: "center" },
  { key: "intent", label: "Intent", sort: "intent", className: "w-24" },
  { key: "signal", label: "Signal", className: "min-w-[180px]" },
  { key: "status", label: "Status", className: "w-24" },
  { key: "stage", label: "Stage", className: "w-28" },
  { key: "channels", label: "Reachable", className: "w-24" },
  { key: "value", label: "Value", sort: "value", className: "w-20", align: "right" },
  { key: "activity", label: "Last activity", sort: "activity", className: "w-24" },
  { key: "next", label: "Next action", className: "min-w-[150px]" },
  { key: "owner", label: "Owner", className: "w-9", align: "center" },
  { key: "surfaced", label: "Surfaced", sort: "surfaced", className: "w-24" },
];

export function LeadsTable({
  rows,
  selected,
  onSelectedChange,
  sort,
  dir,
  onSort,
  density = "normal",
  pending,
}: {
  rows: LeadRow[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  sort: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  density?: "normal" | "compact";
  pending?: boolean;
}) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));

  function toggleAll() {
    if (allSelected) {
      const next = new Set(selected);
      rows.forEach((r) => next.delete(r.id));
      onSelectedChange(next);
    } else {
      const next = new Set(selected);
      rows.forEach((r) => next.add(r.id));
      onSelectedChange(next);
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  }

  const cellPad = density === "compact" ? "px-2 py-1" : "px-2 py-2";

  return (
    <div className={cn("overflow-x-auto transition-opacity", pending && "opacity-60")}>
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">
          Leads, sorted by {sort} {dir === "desc" ? "descending" : "ascending"}
        </caption>
        <thead className="sticky top-0 z-10 bg-surface-sunken">
          <tr className="border-b border-border">
            {COLUMNS.map((col) => {
              const isSorted = col.sort === sort;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={isSorted ? (dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    "whitespace-nowrap px-2 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    col.className
                  )}
                >
                  {col.key === "select" ? (
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                      aria-label="Select all rows on this page"
                    />
                  ) : col.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.sort!)}
                      className={cn(
                        "inline-flex items-center gap-1 transition-colors hover:text-secondary",
                        isSorted && "text-primary"
                      )}
                    >
                      {col.label}
                      {isSorted ? (
                        dir === "asc" ? (
                          <ArrowUp className="size-2.5" />
                        ) : (
                          <ArrowDown className="size-2.5" />
                        )
                      ) : (
                        <ArrowUpDown className="size-2.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const isSelected = selected.has(row.id);
            return (
              <tr
                key={row.id}
                className={cn(
                  "group border-b border-border-subtle transition-colors",
                  isSelected ? "bg-brand-subtle/40" : "hover:bg-surface-hover"
                )}
              >
                <td className={cellPad}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleOne(row.id)}
                    aria-label={`Select ${row.person.name}`}
                  />
                </td>

                <td className={cellPad}>
                  <button
                    type="button"
                    aria-label={row.isStarred ? `Unstar ${row.person.name}` : `Star ${row.person.name}`}
                    aria-pressed={row.isStarred}
                    className="rounded p-0.5 text-muted transition-colors hover:text-warning"
                  >
                    <Star className={cn("size-3.5", row.isStarred && "fill-warning text-warning")} />
                  </button>
                </td>

                {/* Lead */}
                <td className={cellPad}>
                  <div className="flex items-center gap-2">
                    <Avatar name={row.person.name} src={row.person.avatarUrl} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/leads/${row.id}`}
                          className="truncate font-medium text-primary hover:text-brand-text"
                        >
                          {row.person.name}
                        </Link>
                        {row.person.isDecisionMaker ? (
                          <Tooltip content="Holds decision-making authority">
                            <span className="text-2xs font-bold text-brand" aria-label="Decision maker">
                              DM
                            </span>
                          </Tooltip>
                        ) : null}
                        {row.isArchived ? (
                          <Badge size="sm" variant="outline" uppercase>
                            Archived
                          </Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-2xs text-muted">{row.person.title}</p>
                    </div>
                  </div>
                </td>

                {/* Company */}
                <td className={cellPad}>
                  <div className="flex items-center gap-2">
                    <CompanyAvatar name={row.company.name} src={row.company.logoUrl} size="xs" />
                    <div className="min-w-0">
                      <Link
                        href={`/accounts/${row.company.id}`}
                        className="block truncate text-secondary hover:text-brand-text"
                      >
                        {row.company.name}
                      </Link>
                      <p className="truncate text-2xs text-muted">
                        {[row.company.industry, row.company.city].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                </td>

                <td className={cn(cellPad, "text-center")}>
                  <TierBadge tier={row.tier as TierKey} />
                </td>

                <td className={cn(cellPad, "text-center")}>
                  <Tooltip
                    content={
                      row.isScoreOverridden
                        ? "Manually overridden. Open the dossier to see the original and the reason."
                        : "Open the dossier to see the eight dimensions behind this."
                    }
                  >
                    <Link href={`/leads/${row.id}#why`} className="inline-flex">
                      <ScorePill score={row.score} />
                    </Link>
                  </Tooltip>
                </td>

                <td className={cellPad}>
                  <IntentBadge intent={row.intent as IntentKey} size="sm" />
                </td>

                {/* Signal */}
                <td className={cellPad}>
                  {row.latestSignal ? (
                    <Tooltip
                      content={
                        <>
                          <strong>{row.latestSignal.title}</strong>
                          <div className="mt-0.5 text-muted">
                            {SIGNAL_TYPE_LABEL[row.latestSignal.type]} ·{" "}
                            {row.latestSignal.confidence}% confidence ·{" "}
                            {formatAge(row.latestSignal.occurredAt)}
                          </div>
                          {row.counts.signals > 1 ? (
                            <div className="mt-1 text-muted">
                              {row.counts.signals} signals in total
                            </div>
                          ) : null}
                        </>
                      }
                    >
                      <div className="min-w-0 cursor-help">
                        <p className="truncate text-secondary">{row.latestSignal.title}</p>
                        <p className="truncate text-2xs text-muted">
                          {SIGNAL_TYPE_LABEL[row.latestSignal.type]} ·{" "}
                          {formatAge(row.latestSignal.occurredAt)}
                          {row.counts.signals > 1 ? ` · +${row.counts.signals - 1} more` : ""}
                        </p>
                      </div>
                    </Tooltip>
                  ) : (
                    <Tooltip content="Matched your ICP but no buying signal has appeared yet.">
                      <span className="cursor-help text-2xs text-muted">ICP match only</span>
                    </Tooltip>
                  )}
                </td>

                <td className={cellPad}>
                  <LeadStatusBadge status={row.status as LeadStatusKey} />
                </td>

                <td className={cellPad}>
                  {row.deal ? (
                    <Link
                      href={`/pipeline?deal=${row.deal.id}`}
                      className="truncate text-2xs text-secondary hover:text-brand-text"
                    >
                      {row.deal.stage}
                    </Link>
                  ) : (
                    <span className="text-2xs text-muted">—</span>
                  )}
                </td>

                <td className={cellPad}>
                  <ChannelDots channels={row.channels} />
                </td>

                <td className={cn(cellPad, "text-right")}>
                  {row.deal ? (
                    <span className="font-medium text-primary tabular">
                      {formatInrCompact(row.deal.valueInr)}
                    </span>
                  ) : row.estimatedBudgetInr ? (
                    <Tooltip content="Estimated deal size, not a confirmed budget">
                      <span className="cursor-help text-muted tabular">
                        ~{formatInrCompact(row.estimatedBudgetInr)}
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="text-2xs text-muted">—</span>
                  )}
                </td>

                <td className={cellPad}>
                  <Tooltip
                    content={
                      row.lastActivityAt
                        ? formatDate(row.lastActivityAt)
                        : "Nothing recorded against this lead yet"
                    }
                  >
                    <span
                      className={cn(
                        "cursor-help text-2xs",
                        row.repliedAt ? "font-medium text-success-text" : "text-muted"
                      )}
                    >
                      {row.repliedAt ? "replied " : ""}
                      {formatAge(row.lastActivityAt)}
                    </span>
                  </Tooltip>
                </td>

                {/* Next action */}
                <td className={cellPad}>
                  {row.nextActionLabel ? (
                    <div className="min-w-0">
                      <p className="truncate text-2xs text-secondary">{row.nextActionLabel}</p>
                      {row.nextActionAt ? (
                        <p
                          className={cn(
                            "flex items-center gap-0.5 text-2xs",
                            isPast(row.nextActionAt) ? "text-danger-text" : "text-muted"
                          )}
                        >
                          <Clock className="size-2.5" />
                          {formatAge(row.nextActionAt)}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <Tooltip content="No next step scheduled — the most common reason deals go quiet.">
                      <span className="cursor-help text-2xs text-warning-text">None set</span>
                    </Tooltip>
                  )}
                </td>

                <td className={cn(cellPad, "text-center")}>
                  {row.owner ? (
                    <Tooltip content={`Owned by ${row.owner.name}`}>
                      <span className="inline-flex">
                        <Avatar name={row.owner.name} src={row.owner.avatarUrl} size="xs" />
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="text-2xs text-muted">—</span>
                  )}
                </td>

                <td className={cellPad}>
                  <Tooltip
                    content={
                      <>
                        <strong>Why surfaced</strong>
                        <div className="mt-0.5 text-muted">{row.surfacedReason}</div>
                      </>
                    }
                  >
                    <span className="cursor-help text-2xs text-muted">
                      {formatAge(row.surfacedAt)}
                    </span>
                  </Tooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Card view — better for scanning the reason a lead exists. */
export function LeadsCards({
  rows,
  selected,
  onSelectedChange,
  pending,
}: {
  rows: LeadRow[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  pending?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-2.5 p-3 sm:grid-cols-2 xl:grid-cols-3 transition-opacity",
        pending && "opacity-60"
      )}
    >
      {rows.map((row) => {
        const isSelected = selected.has(row.id);
        return (
          <div
            key={row.id}
            className={cn(
              "rounded-lg border bg-surface p-3 transition-colors",
              isSelected ? "border-brand bg-brand-subtle/30" : "border-border hover:border-border-strong"
            )}
          >
            <div className="flex items-start gap-2.5">
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => {
                  const next = new Set(selected);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  onSelectedChange(next);
                }}
                aria-label={`Select ${row.person.name}`}
                className="mt-1"
              />
              <Avatar name={row.person.name} src={row.person.avatarUrl} size="md" />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/leads/${row.id}`}
                    className="truncate text-xs font-semibold text-primary hover:text-brand-text"
                  >
                    {row.person.name}
                  </Link>
                  <TierBadge tier={row.tier as TierKey} size="sm" />
                </div>
                <p className="truncate text-2xs text-secondary">{row.person.title}</p>
                <p className="truncate text-2xs text-muted">{row.company.name}</p>
              </div>

              <ScorePill score={row.score} />
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <IntentBadge intent={row.intent as IntentKey} size="sm" />
              <LeadStatusBadge status={row.status as LeadStatusKey} />
              {row.deal ? (
                <Badge size="sm" variant="brand">
                  {formatInrCompact(row.deal.valueInr)}
                </Badge>
              ) : null}
            </div>

            <p className="mt-2 line-clamp-2 border-t border-border-subtle pt-2 text-2xs leading-relaxed text-secondary">
              <Sparkles className="mr-1 inline size-3 text-ai-accent" />
              {row.surfacedReason}
            </p>

            <div className="mt-2 flex items-center justify-between gap-2">
              <ChannelDots channels={row.channels} />
              <span className="text-2xs text-muted">{formatAge(row.surfacedAt)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
