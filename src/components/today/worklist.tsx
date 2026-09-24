"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  Clock,
  Mail,
  MessageCircle,
  Phone,
  Sparkles,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import { IntentBadge, ScorePill, TierBadge } from "@/components/domain/indicators";
import { formatAge, formatInrCompact } from "@/lib/format";
import { TASK_PRIORITY, type IntentKey, type TierKey } from "@/lib/vocab";
import { TaskDelegateButton, TaskSnoozeMenu, taskDoItHref, useTaskCompletion } from "@/components/tasks/task-actions";
import { cn } from "@/lib/utils";

export type WorklistItem = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  priorityScore: number;
  priorityReason: string | null;
  recommendedAction: string | null;
  expectedImpactInr: number | null;
  revenueImpact: string | null;
  channel: string | null;
  dueAt: string | null;
  isOverdue: boolean;
  createdByAi: boolean;
  lead: {
    id: string;
    name: string;
    avatarUrl: string | null;
    company: string;
    companyId: string;
    tier: string;
    intent: string;
    score: number | null;
    latestSignal: { title: string; occurredAt: string; type: string } | null;
  } | null;
  deal: { id: string; title: string; valueInr: number; stage: string } | null;
};

const CHANNEL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  EMAIL: Mail,
  PHONE: Phone,
  WHATSAPP: MessageCircle,
};

/**
 * §9 — ranked by expected business impact, not due date. The rank number is
 * shown next to the reason it holds that rank, because a priority you can't
 * interrogate is just an assertion.
 */
export function Worklist({ items }: { items: WorklistItem[] }) {
  const { completed, complete: completeTask } = useTaskCompletion();
  const [expanded, setExpanded] = React.useState<string | null>(items[0]?.id ?? null);

  const visible = items.filter((i) => !completed.has(i.id));

  const complete = (item: WorklistItem) => void completeTask(item);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            Do this now
            <Sparkles className="size-3.5 text-ai-accent" />
          </CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            Ranked by expected revenue impact — intent, value, stage, deadline and reachability
            combined. Not by due date.
          </p>
        </div>
        <Button variant="ghost" size="xs" asChild>
          <Link href="/my-queue">Full queue</Link>
        </Button>
      </CardHeader>

      <CardContent className="p-0 pb-0">
        {visible.length === 0 ? (
          <EmptyState
            compact
            icon={Check}
            title={items.length === 0 ? "Nothing queued for you" : "Everything cleared"}
            description={
              items.length === 0
                ? "No tasks are assigned to you. Work surfaces here automatically when a lead replies, a deal stalls, or a follow-up comes due."
                : "You worked through the whole list. New items appear as signals arrive."
            }
            action={
              items.length === 0 ? (
                <Button size="sm" variant="secondary" asChild>
                  <Link href="/leads?shortcut=hot-intent">Browse hot leads</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ol className="divide-hairline border-t border-border-subtle">
            {visible.map((item, i) => {
              const Icon = item.channel ? CHANNEL_ICON[item.channel] : null;
              const isOpen = expanded === item.id;
              const priority = TASK_PRIORITY[item.priority] ?? TASK_PRIORITY.MEDIUM;

              return (
                <li key={item.id} className="group">
                  <div className="flex items-start gap-2.5 px-4 py-2.5">
                    {/* Rank */}
                    <Tooltip content={`Priority score ${item.priorityScore} of 100`}>
                      <span
                        className={cn(
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-2xs font-bold tabular",
                          i === 0
                            ? "bg-brand text-brand-fg"
                            : i < 3
                              ? "bg-brand-subtle text-brand-text"
                              : "bg-surface-sunken text-muted"
                        )}
                      >
                        {i + 1}
                      </span>
                    </Tooltip>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : item.id)}
                          className="min-w-0 text-left text-xs font-medium text-primary hover:text-brand-text"
                          aria-expanded={isOpen}
                        >
                          {item.title}
                        </button>
                        <Badge variant={priority.variant} size="sm" uppercase>
                          {priority.label}
                        </Badge>
                        {item.isOverdue ? (
                          <Badge variant="danger" size="sm" uppercase>
                            <Clock />
                            Overdue
                          </Badge>
                        ) : null}
                        {item.createdByAi ? (
                          <Tooltip content="Surfaced by an AI agent. The reason is shown below.">
                            <Badge variant="ai" size="sm" uppercase>
                              Auto
                            </Badge>
                          </Tooltip>
                        ) : null}
                      </div>

                      {/* Context line */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted">
                        {item.lead ? (
                          <span className="flex items-center gap-1">
                            <Avatar name={item.lead.name} src={item.lead.avatarUrl} size="xs" />
                            <Link href={`/leads/${item.lead.id}`} className="hover:text-brand-text">
                              {item.lead.name}
                            </Link>
                            <span className="text-muted/70">·</span>
                            <span>{item.lead.company}</span>
                            <TierBadge tier={item.lead.tier as TierKey} size="sm" />
                            <IntentBadge intent={item.lead.intent as IntentKey} size="sm" showDot={false} />
                            {item.lead.score !== null ? <ScorePill score={item.lead.score} /> : null}
                          </span>
                        ) : null}
                        {item.expectedImpactInr ? (
                          <Tooltip content="Expected revenue this action influences, based on the related deal or estimated lead value.">
                            <span className="font-semibold text-secondary tabular">
                              {formatInrCompact(item.expectedImpactInr)}
                            </span>
                          </Tooltip>
                        ) : null}
                        {item.dueAt ? <span>due {formatAge(item.dueAt)}</span> : null}
                      </div>

                      {/* Expanded: why it ranks here */}
                      {isOpen ? (
                        <div className="mt-2 space-y-2 rounded-md border border-border-subtle bg-surface-sunken p-2.5 animate-in-up">
                          {item.priorityReason ? (
                            <div>
                              <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                                Why now?
                              </p>
                              <p className="mt-0.5 text-xs leading-relaxed text-secondary">
                                {item.priorityReason}
                              </p>
                            </div>
                          ) : null}
                          {item.recommendedAction ? (
                            <div>
                              <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                                Recommended
                              </p>
                              <p className="mt-0.5 text-xs leading-relaxed text-secondary">
                                {item.recommendedAction}
                              </p>
                            </div>
                          ) : null}
                          {item.lead?.latestSignal ? (
                            <div>
                              <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                                Relevant signal
                              </p>
                              <p className="mt-0.5 text-xs leading-relaxed text-secondary">
                                {item.lead.latestSignal.title}{" "}
                                <span className="text-muted">
                                  · {formatAge(item.lead.latestSignal.occurredAt)}
                                </span>
                              </p>
                            </div>
                          ) : null}
                          {item.deal ? (
                            <div>
                              <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                                Deal
                              </p>
                              <p className="mt-0.5 text-xs text-secondary">
                                {item.deal.title} · {formatInrCompact(item.deal.valueInr)} ·{" "}
                                {item.deal.stage}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1">
                      {taskDoItHref(item) ? (
                        <Button variant="secondary" size="sm" className="hidden sm:inline-flex" asChild>
                          <Link href={taskDoItHref(item)!}>
                            {Icon ? <Icon /> : null}
                            Do it
                          </Link>
                        </Button>
                      ) : null}

                      <Tooltip content="Mark complete">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => complete(item)}
                          aria-label={`Mark "${item.title}" complete`}
                        >
                          <Check />
                        </Button>
                      </Tooltip>

                      {item.lead ? (
                        <Tooltip content="Draft a reply">
                          <Button variant="ghost" size="icon-sm" asChild aria-label="Draft a reply">
                            <Link href={`/leads/${item.lead.id}?do=email`}><Sparkles /></Link>
                          </Button>
                        </Tooltip>
                      ) : null}
                      <TaskSnoozeMenu taskId={item.id} size="xs" />
                      <TaskDelegateButton taskId={item.id} size="xs" />

                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : item.id)}
                        aria-label={isOpen ? "Collapse details" : "Expand details"}
                        className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-secondary"
                      >
                        <ChevronDown
                          className={cn("size-3.5 transition-transform duration-150", isOpen && "rotate-180")}
                        />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
