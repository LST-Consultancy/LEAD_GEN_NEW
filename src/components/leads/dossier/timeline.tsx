"use client";

import * as React from "react";
import {
  Activity as ActivityIcon,
  Bot,
  Building2,
  Calendar,
  ExternalLink,
  FileText,
  Mail,
  MessageCircle,
  Newspaper,
  Sparkles,
  StickyNote,
  TrendingUp,
  UserRoundPlus,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime, formatAge } from "@/lib/format";
import { SIGNAL_SOURCE_LABEL, SIGNAL_TYPE_LABEL } from "@/lib/vocab";
import { cn } from "@/lib/utils";

type Signal = {
  id: string;
  type: string;
  sourceKind: string;
  sourceName: string;
  sourceUrl: string | null;
  title: string;
  excerpt: string;
  aiInterpretation: string | null;
  confidence: number;
  suggestedAction: string | null;
  keywords: string[];
  occurredAt: string;
  detectedAt: string;
};

type ActivityRow = {
  id: string;
  kind: string;
  summary: string;
  detail: string | null;
  actorType: string;
  channel: string | null;
  amountInr: number | null;
  occurredAt: string;
};

const SIGNAL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  SOCIAL_POST: MessageCircle,
  SOCIAL_COMMENT: MessageCircle,
  HIRING: UserRoundPlus,
  JOB_CHANGE: UserRoundPlus,
  FUNDING: TrendingUp,
  TECH_CHANGE: ActivityIcon,
  WEBSITE_UPDATE: Building2,
  ANNOUNCEMENT: Newspaper,
  NEWS: Newspaper,
  RFP: FileText,
  MEETING: Calendar,
  EMAIL_ACTIVITY: Mail,
  PROPOSAL_ACTIVITY: FileText,
  MANUAL_NOTE: StickyNote,
};

/**
 * §26 — one chronological record, merging detected signals with recorded
 * activity. Signals carry their source, excerpt, confidence and the AI's
 * reading of them; nothing appears without provenance.
 */
export function SignalTimeline({
  signals,
  activities,
}: {
  signals: Signal[];
  activities: ActivityRow[];
}) {
  const [filter, setFilter] = React.useState<"all" | "signals" | "activity">("all");
  const [limit, setLimit] = React.useState(12);

  const merged = React.useMemo(() => {
    const items: (
      | { kind: "signal"; at: string; signal: Signal }
      | { kind: "activity"; at: string; activity: ActivityRow }
    )[] = [];
    if (filter !== "activity") {
      for (const s of signals) items.push({ kind: "signal", at: s.occurredAt, signal: s });
    }
    if (filter !== "signals") {
      for (const a of activities) items.push({ kind: "activity", at: a.occurredAt, activity: a });
    }
    return items.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
  }, [signals, activities, filter]);

  const visible = merged.slice(0, limit);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Buying signal timeline</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            {signals.length} signal{signals.length === 1 ? "" : "s"} · {activities.length} recorded
            {activities.length === 1 ? " event" : " events"}
          </p>
        </div>
        <div
          className="flex items-center gap-0.5 rounded-md border border-border bg-surface-sunken p-0.5"
          role="group"
          aria-label="Timeline filter"
        >
          {(
            [
              ["all", "All"],
              ["signals", "Signals"],
              ["activity", "Activity"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                "rounded px-1.5 py-0.5 text-2xs font-medium transition-colors",
                filter === key ? "bg-surface text-primary shadow-card" : "text-muted hover:text-secondary"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent>
        {visible.length === 0 ? (
          <EmptyState
            compact
            icon={ActivityIcon}
            title="Nothing on the timeline yet"
            description="Signals appear here as they are detected. Your own emails, calls and meetings appear alongside them once logged."
          />
        ) : (
          <>
            <ol className="relative space-y-3 pl-5">
              {/* The spine */}
              <span
                className="absolute bottom-2 left-[7px] top-2 w-px bg-border"
                aria-hidden
              />

              {visible.map((item) =>
                item.kind === "signal" ? (
                  <SignalEntry key={item.signal.id} signal={item.signal} />
                ) : (
                  <ActivityEntry key={item.activity.id} activity={item.activity} />
                )
              )}
            </ol>

            {merged.length > limit ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 w-full"
                onClick={() => setLimit((l) => l + 20)}
              >
                Show {Math.min(20, merged.length - limit)} more of {merged.length}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SignalEntry({ signal }: { signal: Signal }) {
  const Icon = SIGNAL_ICON[signal.type] ?? Sparkles;
  return (
    <li className="relative">
      <span className="absolute -left-5 top-0.5 flex size-[15px] items-center justify-center rounded-full border border-brand-border bg-brand-subtle">
        <Icon className="size-2 text-brand-text" />
      </span>

      <div className="rounded-md border border-border bg-surface p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge size="sm" variant="brand">
            {SIGNAL_TYPE_LABEL[signal.type] ?? signal.type}
          </Badge>
          <span className="text-2xs text-muted">
            {SIGNAL_SOURCE_LABEL[signal.sourceKind] ?? signal.sourceName}
          </span>
          <Tooltip content={`Occurred ${formatDateTime(signal.occurredAt)} · detected ${formatDateTime(signal.detectedAt)}`}>
            <span className="cursor-help text-2xs text-muted">{formatAge(signal.occurredAt)}</span>
          </Tooltip>
          <Tooltip content="How confident the system is that this signal means what it appears to mean.">
            <span
              className={cn(
                "ml-auto cursor-help text-2xs font-semibold tabular",
                signal.confidence >= 80
                  ? "text-success-text"
                  : signal.confidence >= 60
                    ? "text-secondary"
                    : "text-warning-text"
              )}
            >
              {signal.confidence}%
            </span>
          </Tooltip>
        </div>

        <p className="mt-1.5 text-xs font-medium text-primary">{signal.title}</p>

        <blockquote className="mt-1.5 border-l-2 border-border-strong pl-2 text-2xs italic leading-relaxed text-secondary">
          “{signal.excerpt}”
        </blockquote>

        {signal.aiInterpretation ? (
          <p className="mt-1.5 flex gap-1.5 text-2xs leading-relaxed text-muted">
            <Sparkles className="mt-0.5 size-2.5 shrink-0 text-ai-accent" />
            {signal.aiInterpretation}
          </p>
        ) : null}

        {signal.suggestedAction ? (
          <p className="mt-1.5 rounded bg-brand-subtle px-2 py-1 text-2xs leading-relaxed text-brand-text">
            <strong>Suggested:</strong> {signal.suggestedAction}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {signal.keywords.slice(0, 5).map((k) => (
            <span
              key={k}
              className="rounded border border-border-subtle bg-surface-sunken px-1 text-2xs text-muted"
            >
              {k}
            </span>
          ))}
          {signal.sourceUrl ? (
            <a
              href={signal.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto inline-flex items-center gap-0.5 text-2xs text-brand-text hover:underline"
            >
              Source
              <ExternalLink className="size-2.5" />
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ActivityEntry({ activity }: { activity: ActivityRow }) {
  const isAi = activity.actorType === "AI";
  return (
    <li className="relative">
      <span
        className={cn(
          "absolute -left-5 top-1 flex size-[15px] items-center justify-center rounded-full border",
          isAi ? "border-ai-border bg-ai-surface" : "border-border bg-surface"
        )}
      >
        {isAi ? (
          <Bot className="size-2 text-ai-accent" />
        ) : (
          <span className="size-1 rounded-full bg-border-strong" />
        )}
      </span>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-0.5">
        <p className="text-xs text-secondary">{activity.summary}</p>
        {isAi ? (
          <Badge size="sm" variant="ai" uppercase>
            AI
          </Badge>
        ) : null}
        <span className="text-2xs text-muted">{formatAge(activity.occurredAt)}</span>
        <span className="font-mono text-2xs text-muted/70">{activity.kind}</span>
      </div>
      {activity.detail ? (
        <p className="mt-0.5 pl-0.5 text-2xs leading-relaxed text-muted">{activity.detail}</p>
      ) : null}
    </li>
  );
}
