"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Clock, FileText, GripVertical, ListChecks } from "lucide-react";
import { Avatar, CompanyAvatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { IntentBadge, ScorePill, TierBadge } from "@/components/domain/indicators";
import { formatAge, formatDate, formatInrCompact } from "@/lib/format";
import type { IntentKey, TierKey } from "@/lib/vocab";
import { cn } from "@/lib/utils";

export type Deal = {
  id: string;
  title: string;
  valueInr: number;
  status: string;
  confidence: number;
  sortOrder: number;
  stageId: string;
  ageInStageDays: number;
  isStalled: boolean;
  inactiveDays: number | null;
  expectedCloseAt: string | null;
  nextActionAt: string | null;
  nextActionLabel: string | null;
  isNextActionOverdue: boolean;
  lostReason: string | null;
  company: {
    id: string;
    name: string;
    domain: string | null;
    logoUrl: string | null;
    industry: string | null;
    city: string | null;
  };
  owner: { id: string; name: string; avatarUrl: string | null } | null;
  lead: {
    id: string;
    name: string;
    avatarUrl: string | null;
    tier: string;
    intent: string;
    score: number | null;
  } | null;
  risks: {
    code: string;
    severity: string;
    title: string;
    explanation: string;
    suggestedAction: string | null;
  }[];
  counts: { tasks: number; proposals: number };
};

/**
 * A deal card. Risk is shown as a coloured left edge plus an explicit icon and
 * count, never colour alone — and the tooltip always says *why* it is flagged
 * rather than just that it is (§35, §115).
 */
export function DealCard({
  deal,
  dragging,
  overlay,
  listeners,
  attributes,
  setNodeRef,
  style,
}: {
  deal: Deal;
  dragging?: boolean;
  overlay?: boolean;
  listeners?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  setNodeRef?: (el: HTMLElement | null) => void;
  style?: React.CSSProperties;
}) {
  const highRisk = deal.risks.some((r) => r.severity === "high");
  const hasRisk = deal.risks.length > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-lg border bg-surface transition-shadow",
        hasRisk
          ? highRisk
            ? "border-border border-l-2 border-l-danger"
            : "border-border border-l-2 border-l-warning"
          : "border-border",
        dragging && "opacity-30",
        overlay && "shadow-drag rotate-1",
        !overlay && !dragging && "hover:shadow-raised"
      )}
    >
      <div className="p-2.5">
        <div className="flex items-start gap-1.5">
          {/* Drag handle is its own target so clicking the card still navigates */}
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${deal.title}`}
            className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-border-strong opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>

          <CompanyAvatar name={deal.company.name} src={deal.company.logoUrl} size="xs" />

          <div className="min-w-0 flex-1">
            <Link
              href={`/accounts/${deal.company.id}`}
              className="block truncate text-2xs font-medium text-secondary hover:text-brand-text"
            >
              {deal.company.name}
            </Link>
            <p className="truncate text-xs font-semibold text-primary">{deal.title.replace(`${deal.company.name} — `, "")}</p>
          </div>

          <span className="shrink-0 text-xs font-semibold text-primary tabular">
            {formatInrCompact(deal.valueInr)}
          </span>
        </div>

        {/* Lead attribution */}
        {deal.lead ? (
          <div className="mt-2 flex items-center gap-1.5">
            <Avatar name={deal.lead.name} src={deal.lead.avatarUrl} size="xs" />
            <Link
              href={`/leads/${deal.lead.id}`}
              className="min-w-0 truncate text-2xs text-secondary hover:text-brand-text"
            >
              {deal.lead.name}
            </Link>
            <TierBadge tier={deal.lead.tier as TierKey} size="sm" />
            <IntentBadge intent={deal.lead.intent as IntentKey} size="sm" showDot={false} />
            {deal.lead.score !== null ? <ScorePill score={deal.lead.score} /> : null}
          </div>
        ) : null}

        {/* Next action */}
        {deal.nextActionLabel ? (
          <p
            className={cn(
              "mt-2 flex items-center gap-1 text-2xs",
              deal.isNextActionOverdue ? "text-danger-text" : "text-secondary"
            )}
          >
            <Clock className="size-2.5 shrink-0" />
            <span className="truncate">{deal.nextActionLabel}</span>
            {deal.nextActionAt ? (
              <span className="shrink-0 text-muted">· {formatAge(deal.nextActionAt)}</span>
            ) : null}
          </p>
        ) : deal.status === "OPEN" ? (
          <Tooltip content="Open deals with no dated next step are the largest single source of silent pipeline loss.">
            <p className="mt-2 flex cursor-help items-center gap-1 text-2xs text-warning-text">
              <Clock className="size-2.5" />
              No next action
            </p>
          </Tooltip>
        ) : null}

        {deal.lostReason ? (
          <p className="mt-2 rounded bg-danger-subtle px-1.5 py-1 text-2xs leading-relaxed text-danger-text">
            {deal.lostReason}
          </p>
        ) : null}

        {/* Footer: age, risk, counts, owner */}
        <div className="mt-2 flex items-center gap-1.5 border-t border-border-subtle pt-2">
          <Tooltip
            content={
              deal.isStalled
                ? `In this stage ${deal.ageInStageDays} days — past the normal dwell time for it.`
                : `In this stage ${deal.ageInStageDays} ${deal.ageInStageDays === 1 ? "day" : "days"}.`
            }
          >
            <span
              className={cn(
                "cursor-help text-2xs tabular",
                deal.isStalled ? "font-semibold text-warning-text" : "text-muted"
              )}
            >
              {deal.ageInStageDays}d
            </span>
          </Tooltip>

          {hasRisk ? (
            <Tooltip
              content={
                <ul className="space-y-1.5">
                  {deal.risks.map((r) => (
                    <li key={r.code}>
                      <strong className={r.severity === "high" ? "text-danger-text" : "text-warning-text"}>
                        {r.title}
                      </strong>
                      <div className="text-muted">{r.explanation}</div>
                      {r.suggestedAction ? (
                        <div className="mt-0.5 text-secondary">→ {r.suggestedAction}</div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              }
            >
              <span
                className={cn(
                  "inline-flex cursor-help items-center gap-0.5 text-2xs font-medium",
                  highRisk ? "text-danger-text" : "text-warning-text"
                )}
              >
                <AlertTriangle className="size-2.5" />
                {deal.risks.length}
              </span>
            </Tooltip>
          ) : null}

          {deal.counts.tasks > 0 ? (
            <Tooltip content={`${deal.counts.tasks} open ${deal.counts.tasks === 1 ? "task" : "tasks"}`}>
              <span className="inline-flex cursor-help items-center gap-0.5 text-2xs text-muted">
                <ListChecks className="size-2.5" />
                {deal.counts.tasks}
              </span>
            </Tooltip>
          ) : null}

          {deal.counts.proposals > 0 ? (
            <Tooltip content={`${deal.counts.proposals} ${deal.counts.proposals === 1 ? "proposal" : "proposals"}`}>
              <span className="inline-flex cursor-help items-center gap-0.5 text-2xs text-muted">
                <FileText className="size-2.5" />
                {deal.counts.proposals}
              </span>
            </Tooltip>
          ) : null}

          {deal.expectedCloseAt ? (
            <Tooltip content={`Owner expects to close ${formatDate(deal.expectedCloseAt)}`}>
              <span className="ml-auto cursor-help text-2xs text-muted">
                {formatDate(deal.expectedCloseAt).replace(/ \d{4}$/, "")}
              </span>
            </Tooltip>
          ) : (
            <span className="ml-auto" />
          )}

          {deal.owner ? (
            <Tooltip content={`Owned by ${deal.owner.name}`}>
              <span className="shrink-0">
                <Avatar name={deal.owner.name} src={deal.owner.avatarUrl} size="xs" />
              </span>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}
