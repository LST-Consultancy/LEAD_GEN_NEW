"use client";

import * as React from "react";
import Link from "next/link";
import { TaskDelegateButton, TaskSnoozeMenu, taskDoItHref, useTaskCompletion } from "@/components/tasks/task-actions";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import {
  ArrowRight,
  Check,
  Clock,
  Crosshair,
  Mail,
  MessageCircle,
  Phone,
  Sparkles,
  X,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Metric } from "@/components/charts/metric";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { IntentBadge, ScorePill, TierBadge } from "@/components/domain/indicators";
import { formatAge, formatInrCompact } from "@/lib/format";
import { TASK_PRIORITY, type IntentKey, type TierKey } from "@/lib/vocab";
import { cn } from "@/lib/utils";

type Task = {
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
  completedAt: string | null;
  isOverdue: boolean;
  createdByAi: boolean;
  lane: string;
  owner: { id: string; name: string; avatarUrl: string | null } | null;
  collaborators: { id: string; name: string; avatarUrl: string | null }[];
  lead: {
    id: string;
    name: string;
    avatarUrl: string | null;
    company: string;
    companyId: string;
    tier: string;
    intent: string;
    score: number | null;
    hasReplied: boolean;
    latestSignal: { title: string; excerpt: string; occurredAt: string; type: string } | null;
    conversation: {
      aiSummary: string | null;
      messages: { direction: string; body: string; createdAt: string }[];
    } | null;
  } | null;
  deal: {
    id: string;
    title: string;
    valueInr: number;
    stage: string;
    risks: { title: string; explanation: string }[];
  } | null;
};

const TABS = [
  { key: "QUEUED", label: "Queued" },
  { key: "WORKING", label: "Working" },
  { key: "NEEDS_ATTENTION", label: "Needs you" },
  { key: "DONE", label: "Done" },
] as const;

const CHANNEL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  EMAIL: Mail,
  PHONE: Phone,
  WHATSAPP: MessageCircle,
};

export function QueueView({
  lanes,
  counts,
  summary,
  focusOrder,
  initialTab,
  initialFocus = false,
}: {
  lanes: Record<string, Task[]>;
  counts: Record<string, number>;
  summary: {
    activeCount: number;
    overdueCount: number;
    totalImpactInr: number;
    completedToday: number;
  };
  focusOrder: string[];
  initialTab: string;
  initialFocus?: boolean;
}) {
  const [tab, setTab] = React.useState<string>(
    TABS.some((t) => t.key === initialTab) ? initialTab : "NEEDS_ATTENTION"
  );
  const { completed, complete: completeTask } = useTaskCompletion();
  const [focus, setFocus] = React.useState(initialFocus && focusOrder.length > 0);

  const allTasks = React.useMemo(() => Object.values(lanes).flat(), [lanes]);
  const focusQueue = focusOrder
    .map((id) => allTasks.find((t) => t.id === id))
    .filter((t): t is Task => Boolean(t) && !completed.has(t!.id));

  const complete = (task: Task) => void completeTask(task);

  if (focus) {
    return (
      <FocusMode
        queue={focusQueue}
        onComplete={complete}
        onExit={() => setFocus(false)}
      />
    );
  }

  const visible = (lanes[tab] ?? []).filter((t) => !completed.has(t.id));

  return (
    <div className="mx-auto max-w-5xl px-3 py-3 sm:px-4 sm:py-4">
      {/* Summary */}
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="Active" value={String(summary.activeCount)} sub="assigned to you" tone="brand" />
        <Metric
          label="Overdue"
          value={String(summary.overdueCount)}
          sub={summary.overdueCount === 0 ? "nothing late" : "needs catching up"}
          tone={summary.overdueCount > 0 ? "serious" : "good"}
        />
        <Metric
          label="Revenue in play"
          value={formatInrCompact(summary.totalImpactInr)}
          sub="across open items"
          hint="Sum of the expected impact of every active item, from the related deal or estimated lead value."
        />
        <Metric
          label="Done today"
          value={String(summary.completedToday)}
          sub="completed"
          tone="good"
        />
      </div>

      {/* Tabs + focus */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-sunken p-0.5"
          role="tablist"
          aria-label="Queue lanes"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                tab === t.key
                  ? "bg-surface text-primary shadow-card"
                  : "text-muted hover:text-secondary"
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded px-1 text-2xs font-semibold tabular",
                  tab === t.key ? "bg-surface-sunken text-secondary" : "bg-surface text-muted"
                )}
              >
                {counts[t.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="ml-auto" />
        <CreateTaskDialog />
        <Button
          variant="primary"
          size="sm"
          disabled={focusQueue.length === 0}
          onClick={() => setFocus(true)}
        >
          <Crosshair />
          Focus mode
        </Button>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={Check}
            title={tab === "DONE" ? "Nothing completed yet" : "This lane is clear"}
            description={
              tab === "DONE"
                ? "Completed work appears here with the time it was closed."
                : "Add a task, take a recommendation on a lead, or wait for a reply or stalled deal to create one."
            }
            action={tab !== "DONE" ? <CreateTaskDialog /> : undefined}
          />
        </Card>
      ) : (
        <ol className="space-y-2">
          {visible.map((task, i) => (
            <QueueRow key={task.id} task={task} rank={i + 1} onComplete={() => complete(task)} />
          ))}
        </ol>
      )}
    </div>
  );
}

function QueueRow({
  task,
  rank,
  onComplete,
}: {
  task: Task;
  rank: number;
  onComplete: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const priority = TASK_PRIORITY[task.priority] ?? TASK_PRIORITY.MEDIUM;
  const Icon = task.channel ? CHANNEL_ICON[task.channel] : null;

  return (
    <li>
      <Card className={cn(task.isOverdue && "border-l-2 border-l-danger")}>
        <div className="flex items-start gap-2.5 p-3">
          <Tooltip content={`Impact score ${task.priorityScore}/100`}>
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-2xs font-bold tabular",
                rank === 1 ? "bg-brand text-brand-fg" : "bg-surface-sunken text-muted"
              )}
            >
              {rank}
            </span>
          </Tooltip>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                className={cn(
                  "text-left text-xs font-medium hover:text-brand-text",
                  task.status === "DONE" ? "text-muted line-through" : "text-primary"
                )}
              >
                {task.title}
              </button>
              <Badge variant={priority.variant} size="sm" uppercase>
                {priority.label}
              </Badge>
              {task.isOverdue ? (
                <Badge variant="danger" size="sm" uppercase>
                  <Clock />
                  Overdue
                </Badge>
              ) : null}
              {task.createdByAi ? (
                <Badge variant="ai" size="sm" uppercase>
                  Auto
                </Badge>
              ) : null}
              {task.revenueImpact ? (
                <Tooltip
                  content={
                    task.revenueImpact === "direct"
                      ? "Directly moves a deal forward."
                      : task.revenueImpact === "indirect"
                        ? "Supports a deal without advancing it by itself."
                        : "Hygiene — keeps the data trustworthy."
                  }
                >
                  <Badge variant="outline" size="sm">
                    {task.revenueImpact}
                  </Badge>
                </Tooltip>
              ) : null}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted">
              {task.lead ? (
                <span className="flex items-center gap-1">
                  <Avatar name={task.lead.name} src={task.lead.avatarUrl} size="xs" />
                  <Link href={`/leads/${task.lead.id}`} className="hover:text-brand-text">
                    {task.lead.name}
                  </Link>
                  <span>· {task.lead.company}</span>
                  <TierBadge tier={task.lead.tier as TierKey} size="sm" />
                  <IntentBadge intent={task.lead.intent as IntentKey} size="sm" showDot={false} />
                  {task.lead.score !== null ? <ScorePill score={task.lead.score} /> : null}
                </span>
              ) : null}
              {task.expectedImpactInr ? (
                <span className="font-semibold text-secondary tabular">
                  {formatInrCompact(task.expectedImpactInr)}
                </span>
              ) : null}
              {task.dueAt ? (
                <span className={task.isOverdue ? "text-danger-text" : undefined}>
                  due {formatAge(task.dueAt)}
                </span>
              ) : null}
              {task.collaborators.length > 0 ? (
                <span>+{task.collaborators.length} collaborating</span>
              ) : null}
            </div>

            {open ? (
              <div className="mt-2 space-y-2 rounded-md border border-border-subtle bg-surface-sunken p-2.5 animate-in-up">
                {task.priorityReason ? (
                  <Detail label="Why now?" body={task.priorityReason} />
                ) : null}
                {task.recommendedAction ? (
                  <Detail label="Recommended" body={task.recommendedAction} />
                ) : null}
                {task.lead?.latestSignal ? (
                  <Detail
                    label="Relevant signal"
                    body={`${task.lead.latestSignal.title} — “${task.lead.latestSignal.excerpt.slice(0, 160)}${task.lead.latestSignal.excerpt.length > 160 ? "…" : ""}”`}
                  />
                ) : null}
                {task.lead?.conversation?.aiSummary ? (
                  <Detail label="Conversation so far" body={task.lead.conversation.aiSummary} />
                ) : null}
                {task.deal ? (
                  <Detail
                    label="Deal"
                    body={`${task.deal.title} · ${formatInrCompact(task.deal.valueInr)} · ${task.deal.stage}${
                      task.deal.risks.length > 0
                        ? ` · ${task.deal.risks.map((r) => r.title).join("; ")}`
                        : ""
                    }`}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {task.status !== "DONE" ? (
              <>
                {taskDoItHref(task) ? (
                  <Button variant="secondary" size="sm" className="hidden sm:inline-flex" asChild>
                    <Link href={taskDoItHref(task)!}>
                      {Icon ? <Icon /> : null}
                      Do it
                    </Link>
                  </Button>
                ) : null}
                <Tooltip content="Mark complete">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onComplete}
                    aria-label={`Complete "${task.title}"`}
                  >
                    <Check />
                  </Button>
                </Tooltip>
              </>
            ) : task.completedAt ? (
              <span className="text-2xs text-muted">done {formatAge(task.completedAt)}</span>
            ) : null}
          </div>
        </div>
      </Card>
    </li>
  );
}

function Detail({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-secondary">{body}</p>
    </div>
  );
}

/** §38 — Focus Mode: one task, with everything needed to finish it. */
function FocusMode({
  queue,
  onComplete,
  onExit,
}: {
  queue: Task[];
  onComplete: (task: Task) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = React.useState(0);
  const task = queue[index];

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onExit();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, queue.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue.length, onExit]);

  if (!task) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Card>
          <EmptyState
            icon={Check}
            title="Queue cleared"
            description="You worked through everything assigned to you. New items appear as signals arrive."
            action={
              <Button variant="primary" size="sm" onClick={onExit}>
                Back to the queue
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const priority = TASK_PRIORITY[task.priority] ?? TASK_PRIORITY.MEDIUM;
  const Icon = task.channel ? CHANNEL_ICON[task.channel] : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="brand" uppercase>
            <Crosshair />
            Focus
          </Badge>
          <span className="text-xs text-muted tabular">
            {index + 1} of {queue.length}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onExit}>
          <X />
          Exit
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={priority.variant} size="sm" uppercase>
                {priority.label}
              </Badge>
              {task.expectedImpactInr ? (
                <Badge variant="neutral" size="sm">
                  {formatInrCompact(task.expectedImpactInr)}
                </Badge>
              ) : null}
              {task.dueAt ? (
                <span className={cn("text-2xs", task.isOverdue ? "text-danger-text" : "text-muted")}>
                  due {formatAge(task.dueAt)}
                </span>
              ) : null}
            </div>
            <CardTitle className="mt-1.5 text-base">{task.title}</CardTitle>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {task.lead ? (
            <div className="flex items-center gap-2.5 rounded-md border border-border-subtle bg-surface-sunken p-2.5">
              <Avatar name={task.lead.name} src={task.lead.avatarUrl} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link
                    href={`/leads/${task.lead.id}`}
                    className="truncate text-sm font-semibold text-primary hover:text-brand-text"
                  >
                    {task.lead.name}
                  </Link>
                  <TierBadge tier={task.lead.tier as TierKey} />
                  <IntentBadge intent={task.lead.intent as IntentKey} size="sm" />
                </div>
                <p className="truncate text-xs text-secondary">{task.lead.company}</p>
              </div>
              {task.lead.score !== null ? <ScorePill score={task.lead.score} /> : null}
            </div>
          ) : null}

          {task.priorityReason ? (
            <div className="rounded-md border border-brand-border bg-brand-subtle px-3 py-2">
              <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-brand-text">
                <Sparkles className="size-3" />
                Why this one
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-text">{task.priorityReason}</p>
            </div>
          ) : null}

          {task.recommendedAction ? (
            <Detail label="Recommended action" body={task.recommendedAction} />
          ) : null}

          {task.lead?.latestSignal ? (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                The signal behind this
              </p>
              <p className="mt-0.5 text-xs font-medium text-primary">
                {task.lead.latestSignal.title}
              </p>
              <blockquote className="mt-1 border-l-2 border-border-strong pl-2 text-xs italic leading-relaxed text-secondary">
                “{task.lead.latestSignal.excerpt}”
              </blockquote>
              <p className="mt-0.5 text-2xs text-muted">
                {formatAge(task.lead.latestSignal.occurredAt)}
              </p>
            </div>
          ) : null}

          {task.lead?.conversation?.messages.length ? (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                Last messages
              </p>
              <ul className="mt-1 space-y-1.5">
                {task.lead.conversation.messages.map((m, i) => (
                  <li
                    key={i}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-xs leading-relaxed",
                      m.direction === "INBOUND"
                        ? "bg-surface-sunken text-secondary"
                        : "bg-brand-subtle/50 text-secondary"
                    )}
                  >
                    <span className="mb-0.5 block text-2xs uppercase tracking-wider text-muted">
                      {m.direction === "INBOUND" ? "They wrote" : "You wrote"} ·{" "}
                      {formatAge(m.createdAt)}
                    </span>
                    {m.body.slice(0, 320)}
                    {m.body.length > 320 ? "…" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {task.deal ? (
            <Detail
              label="Deal context"
              body={`${task.deal.title} · ${formatInrCompact(task.deal.valueInr)} · ${task.deal.stage}`}
            />
          ) : null}
        </CardContent>

        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-3">
          {taskDoItHref(task) ? (
            <Button variant="primary" size="sm" asChild>
              <Link href={taskDoItHref(task)!}>
                {Icon ? <Icon /> : null}
                Do it
              </Link>
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onComplete(task);
              setIndex((i) => Math.min(i, queue.length - 2));
            }}
          >
            <Check />
            Complete
          </Button>
          <TaskSnoozeMenu taskId={task.id} onDone={() => setIndex((i) => Math.min(i, queue.length - 2))} />
          <TaskDelegateButton taskId={task.id} currentOwnerId={task.owner?.id} onDone={() => setIndex((i) => Math.min(i, queue.length - 2))} />
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={index >= queue.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          >
            Next
            <ArrowRight />
          </Button>
        </div>
      </Card>

      <p className="mt-3 text-center text-2xs text-muted">
        ← → to move between items · Esc to exit
      </p>
    </div>
  );
}
