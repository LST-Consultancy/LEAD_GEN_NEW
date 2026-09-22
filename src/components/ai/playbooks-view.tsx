"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Ban, Check, ChevronRight, Clock, Trash2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { formatAge, formatNumber } from "@/lib/format";
import type { PlaybookSummary } from "@/lib/services/playbooks";
import type { ResolvedStep } from "@/lib/playbooks/steps";
import { cn } from "@/lib/utils";

const STEP_BADGE: Record<ResolvedStep["status"], { label: string; variant: "neutral" | "info" | "warning" | "danger" | "success" }> = {
  control: { label: "Wait", variant: "neutral" },
  built: { label: "Runs", variant: "success" },
  unbuilt: { label: "Not built", variant: "warning" },
  unknown: { label: "No such tool", variant: "danger" },
};

/**
 * §65 — playbooks.
 *
 * Every step is resolved against the tool registry, so the screen can say which
 * ones would actually run. Nothing here executes a playbook: the toggle only
 * marks it active, and it refuses to activate one that would do nothing.
 */
export function PlaybooksView({
  playbooks,
  canManage,
}: {
  playbooks: PlaybookSummary[];
  canManage: boolean;
}) {
  const inert = playbooks.filter((p) => p.health.inert).length;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Playbooks</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          A trigger and an ordered list of steps. Each step is checked against the tool registry, so
          a playbook says up front where it would stop — rather than looking active and quietly
          doing nothing.
        </p>
      </div>

      {inert > 0 ? (
        <div className="flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-2.5 text-2xs leading-relaxed text-warning-text">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {inert === playbooks.length
              ? `${playbooks.length === 1 ? "This playbook" : "None of these playbooks"} can run yet`
              : `${inert} of ${playbooks.length} playbooks here cannot run yet`}
            , because their steps depend on tools that aren&apos;t built. They are kept as drafts —
            the shape of the automation is right, and they start working the moment those tools
            land. Activation is refused until then.
          </span>
        </div>
      ) : null}

      {playbooks.length === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              icon={Workflow}
              title="No playbooks yet"
              description="A playbook codifies something that already works for you: the conditions that make a lead worth this treatment, then the steps in order. Write the steps you take by hand today."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {playbooks.map((p) => (
            <PlaybookCard key={p.id} playbook={p} canManage={canManage} />
          ))}
        </div>
      )}

      <p className="text-2xs leading-relaxed text-muted">
        Running a playbook goes through an{" "}
        <Link href="/ai-agents" className="text-brand-text underline-offset-2 hover:underline">
          agent
        </Link>
        , so its budget, guardrails and approval policy apply. Nothing on this screen contacts
        anyone or spends a point.
      </p>
    </div>
  );
}

function PlaybookCard({
  playbook,
  canManage,
}: {
  playbook: PlaybookSummary;
  canManage: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggleActive(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/playbooks/${playbook.id}`, { isActive: next });
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That couldn't be changed. Nothing was updated."
      );
    } finally {
      setBusy(false);
    }
  }

  const blocked = playbook.health.unbuilt.length + playbook.health.unknown.length;

  const trigger = Object.entries(playbook.trigger).filter(
    ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
  );

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex min-w-0 items-start gap-2 text-left"
        >
          <ChevronRight
            className={cn(
              "mt-0.5 size-3.5 shrink-0 text-muted transition-transform duration-150",
              expanded && "rotate-90"
            )}
          />
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-1.5">
              <span className="truncate">{playbook.name}</span>
              {playbook.health.inert ? (
                <Tooltip content={playbook.health.blockedBecause ?? "Nothing in this playbook can run."}>
                  <span className="cursor-help">
                    <Badge variant="danger" size="sm">
                      <Ban className="size-2.5" />
                      Can&apos;t run
                    </Badge>
                  </span>
                </Tooltip>
              ) : playbook.health.blockedBecause ? (
                <Tooltip content={playbook.health.blockedBecause}>
                  <span className="cursor-help">
                    <Badge variant="warning" size="sm">
                      Partly built
                    </Badge>
                  </span>
                </Tooltip>
              ) : (
                <Badge variant="success" size="sm">
                  <Check className="size-2.5" />
                  Ready
                </Badge>
              )}
              {playbook.isAgentTriggerable ? (
                <Tooltip content="An agent may start this without being asked, subject to its own approval policy.">
                  <span className="cursor-help">
                    <Badge variant="info" size="sm">
                      Agent-triggerable
                    </Badge>
                  </span>
                </Tooltip>
              ) : null}
            </CardTitle>
            {playbook.description ? (
              <p className="mt-0.5 text-2xs leading-relaxed text-secondary">
                {playbook.description}
              </p>
            ) : null}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-2xs tabular-nums text-muted">
            {playbook.timesRun === 0
              ? "never run"
              : `${formatNumber(playbook.timesRun)} run${playbook.timesRun === 1 ? "" : "s"}`}
          </span>
          {canManage ? (
            <Tooltip
              content={
                playbook.health.inert
                  ? "Can't be activated until at least one step can run."
                  : playbook.isActive
                    ? "Active. Deactivate to stop it being started."
                    : "Activate so agents may start it."
              }
            >
              <span className={cn(playbook.health.inert && "cursor-not-allowed")}>
                <Switch
                  checked={playbook.isActive}
                  disabled={busy || playbook.health.inert}
                  onCheckedChange={(v) => void toggleActive(v)}
                  aria-label={`${playbook.isActive ? "Deactivate" : "Activate"} ${playbook.name}`}
                />
              </span>
            </Tooltip>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {playbook.health.blockedBecause ? (
          <p className="text-2xs leading-relaxed text-warning-text">
            {playbook.health.blockedBecause}
          </p>
        ) : null}

        {error ? (
          <p className="rounded-md border border-danger-border bg-danger-subtle p-2 text-2xs text-danger-text">
            {error}
          </p>
        ) : null}

        {trigger.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-wider text-muted">
              Triggers on
            </span>
            {trigger.map(([key, value]) => (
              <span
                key={key}
                className="rounded bg-subtle px-1.5 py-0.5 font-mono text-2xs text-secondary"
              >
                {key}: {Array.isArray(value) ? value.join(" / ") : String(value)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-2xs text-muted">
            No trigger conditions — this one only ever starts because someone asked for it.
          </p>
        )}

        {expanded ? (
          <ol className="space-y-1.5 pt-1">
            {playbook.steps.map((step) => {
              const badge = STEP_BADGE[step.status];
              return (
                <li key={step.order} className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-2xs tabular-nums text-muted">
                    {step.order}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-2xs text-primary">{step.action}</span>
                      <Badge size="sm" variant={badge.variant}>
                        {step.status === "control" ? <Clock className="size-2.5" /> : null}
                        {badge.label}
                      </Badge>
                    </div>
                    {step.note ? (
                      <p className="text-2xs leading-relaxed text-secondary">{step.note}</p>
                    ) : null}
                    {step.status !== "built" ? (
                      <p className="text-2xs leading-relaxed text-muted">{step.reason}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
            {playbook.steps.length === 0 ? (
              <li className="text-2xs text-muted">This playbook has no steps.</li>
            ) : null}
          </ol>
        ) : (
          <p className="text-2xs text-muted">
            {playbook.steps.length} step{playbook.steps.length === 1 ? "" : "s"}
            {blocked > 0
              ? ` · ${blocked} blocked by a missing tool`
              : " · all of them runnable"}{" "}
            · updated {formatAge(playbook.updatedAt)}
          </p>
        )}

        {canManage && expanded ? (
          <div className="flex justify-end pt-1">
            <DeleteButton playbook={playbook} onDone={() => router.refresh()} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DeleteButton({ playbook, onDone }: { playbook: PlaybookSummary; onDone: () => void }) {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        <Trash2 />
        Delete
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-2xs text-muted">
        Delete this playbook? It goes to the recycle bin.
      </span>
      <Button
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.del(`/api/playbooks/${playbook.id}`);
            onDone();
          } finally {
            setBusy(false);
          }
        }}
      >
        Delete
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}
