"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EnrollLeadsButton, EnrollmentList } from "@/components/outreach/sequence-actions";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Mail,
  Pause,
  Phone,
  Play,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { CHANNEL_LABEL } from "@/lib/vocab";

type Step = {
  id: string;
  stepOrder: number;
  dayOffset: number;
  channel: string;
  isManualTask: boolean;
  subject: string | null;
  bodyTemplate: string;
  variables: string[];
  unknownVariables: string[];
  copyWarnings: { code: string; message: string }[];
};

type Sequence = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  senderMailboxId: string | null;
  stopOnReply: boolean;
  stopOnUnsubscribe: boolean;
  dailyCap: number;
  timezone: string;
  steps: Step[];
  stats: {
    enrolled: number;
    active: number;
    completed: number;
    stopped: number;
    paused: number;
    replied: number;
    replyRate: number | null;
  };
  schedule: string;
};

type Provider = {
  configured: boolean;
  provider: string | null;
  canReceive: boolean;
  notConfiguredMessage: string;
  repliesNotReadableMessage: string;
  catalogue: {
    name: string;
    label: string;
    suits: string;
    requires: string;
    canReceive: boolean;
  }[];
};

type Senders = { mailboxes: { id: string; address: string; label: string; isDefaultSender: boolean }[]; relay: string | null };

export function OutreachView({
  sequences,
  provider,
  suppressionCount,
  senders = { mailboxes: [], relay: null },
}: {
  sequences: Sequence[];
  provider: Provider;
  suppressionCount: number;
  senders?: Senders;
}) {
  const [expanded, setExpanded] = useState<string | null>(sequences[0]?.id ?? null);

  const totals = sequences.reduce(
    (acc, s) => ({
      active: acc.active + s.stats.active,
      enrolled: acc.enrolled + s.stats.enrolled,
      stopped: acc.stopped + s.stats.stopped,
    }),
    { active: 0, enrolled: 0, stopped: 0 }
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold text-primary">Outreach</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Multi-step sequences with the guardrails that keep a sending domain alive: a send
          window, a daily cap, stop-on-reply, and a do-not-contact list checked before every
          send.
        </p>
        </div>
        <Button variant="primary" size="sm" asChild><Link href="/outreach/new">New sequence</Link></Button>
      </div>

      <ProviderBanner provider={provider} />

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Sequences" value={formatNumber(sequences.length)} hint={`${sequences.filter((s) => s.isActive).length} active`} />
        <Stat label="Leads enrolled" value={formatNumber(totals.enrolled)} hint={`${totals.active} mid-sequence`} />
        <Stat label="Stopped early" value={formatNumber(totals.stopped)} hint="replied, suppressed or unreachable" />
        <Stat
          label="Do-not-contact"
          value={formatNumber(suppressionCount)}
          hint="checked before every send"
        />
      </div>

      {sequences.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Send}
              title="No sequences yet"
              description="A sequence is a short series of messages with days between them, and rules about when it stops. Building one here means the send window, the cap and the stop conditions are enforced by the engine rather than remembered by a person."
              action={<Button variant="primary" size="sm" asChild><Link href="/outreach/new">Build your first sequence</Link></Button>}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {sequences.map((s) => (
            <SequenceCard
              key={s.id}
              sequence={s}
              provider={provider}
              senders={senders}
              expanded={expanded === s.id}
              onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-2xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular text-primary">{value}</p>
      <p className="text-2xs text-muted">{hint}</p>
    </div>
  );
}

function ProviderBanner({ provider }: { provider: Provider }) {
  if (provider.configured && provider.canReceive) {
    return (
      <div className="rounded-lg border border-success-border bg-success-subtle px-3 py-2 text-xs text-success-text">
        <Check className="mr-1 inline size-3" />
        Sending through <strong>{provider.provider}</strong>, which can also read replies — so
        stop-on-reply is enforced automatically.
      </div>
    );
  }

  if (provider.configured && !provider.canReceive) {
    return (
      <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-text">
        <AlertTriangle className="mr-1 inline size-3.5" />
        {provider.repliesNotReadableMessage}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5">
      <p className="text-xs text-warning-text">
        <AlertTriangle className="mr-1 inline size-3.5" />
        <strong>No mailbox is connected.</strong> {provider.notConfiguredMessage}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-2xs font-medium text-warning-text/90">
          What each option needs
        </summary>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {provider.catalogue.map((p) => (
            <li key={p.name} className="rounded-md bg-surface/60 px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-2xs font-semibold text-primary">{p.label}</span>
                {p.canReceive ? (
                  <Badge variant="success" size="sm">
                    Can read replies
                  </Badge>
                ) : (
                  <Tooltip content="Send-only, so stop-on-reply cannot be automatic.">
                    <Badge variant="warning" size="sm">
                      Send only
                    </Badge>
                  </Tooltip>
                )}
              </div>
              <p className="mt-0.5 text-2xs text-secondary">{p.suits}</p>
              <p className="text-2xs text-muted">
                <strong>Needs:</strong> {p.requires}
              </p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function SequenceCard({
  sequence,
  provider,
  expanded,
  onToggle,
  senders = { mailboxes: [], relay: null },
}: {
  sequence: Sequence;
  provider: Provider;
  expanded: boolean;
  onToggle: () => void;
  senders?: Senders;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const toggleActive = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.post<{ note: string }>(`/api/sequences/${sequence.id}/activate`, {
        isActive: !sequence.isActive,
      });
      setMessage({ tone: "ok", text: res.note });
      router.refresh();
    } catch (err) {
      setMessage({
        tone: "bad",
        text: err instanceof Error ? err.message : "That did not work.",
      });
    } finally {
      setBusy(false);
    }
  };

  const changeSender = async (mailboxId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.put<{ note: string }>(`/api/sequences/${sequence.id}/sender`, { mailboxId: mailboxId || null });
      setMessage({ tone: "ok", text: res.note });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "That did not work." });
    } finally {
      setBusy(false);
    }
  };
  const defaultSender = senders.mailboxes.find((m) => m.isDefaultSender)?.address ?? senders.relay;
  const namedMissing = sequence.senderMailboxId && !senders.mailboxes.some((m) => m.id === sequence.senderMailboxId);

  const warnings = sequence.steps.flatMap((s) => s.copyWarnings);
  const brokenSteps = sequence.steps.filter((s) => s.unknownVariables.length > 0);

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-start gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted" />
          )}
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-1.5">
              <span className="truncate">{sequence.name}</span>
              {sequence.isActive ? (
                <Badge variant="success" size="sm">
                  Active
                </Badge>
              ) : (
                <Badge variant="neutral" size="sm">
                  Paused
                </Badge>
              )}
            </CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {sequence.steps.length} {sequence.steps.length === 1 ? "step" : "steps"} ·{" "}
              {sequence.schedule}
            </p>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <div className="text-right">
            <p className="text-2xs text-muted">Enrolled</p>
            <p className="text-sm font-semibold tabular text-primary">
              {formatNumber(sequence.stats.enrolled)}
            </p>
          </div>
          <label className="flex min-w-0 items-center gap-1 text-2xs text-muted">
            Sends from
            <select
              aria-label={`Mailbox ${sequence.name} sends from`}
              value={sequence.senderMailboxId ?? ""}
              disabled={busy}
              onChange={(e) => void changeSender(e.target.value)}
              className="max-w-44 truncate rounded border border-border bg-surface px-1 py-0.5 text-2xs text-primary"
            >
              <option value="">{defaultSender ? `Default (${defaultSender})` : "Default — none set up"}</option>
              {namedMissing ? <option value={sequence.senderMailboxId!}>A mailbox that cannot send now</option> : null}
              {senders.mailboxes.map((m) => <option key={m.id} value={m.id}>{m.address}</option>)}
            </select>
          </label>
          <Button size="sm" variant="ghost" asChild><Link href={`/outreach/${sequence.id}/edit`}>Edit</Link></Button>
          <EnrollLeadsButton sequenceId={sequence.id} sequenceName={sequence.name} />
          <Button
            size="sm"
            variant={sequence.isActive ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => void toggleActive()}
          >
            {sequence.isActive ? <Pause /> : <Play />}
            {sequence.isActive ? "Pause" : "Activate"}
          </Button>
        </div>
      </CardHeader>

      {brokenSteps.length > 0 ? (
        <div className="px-4 pb-2">
          <p className="rounded-md border border-danger-border bg-danger-subtle px-2.5 py-2 text-2xs text-danger-text">
            <AlertTriangle className="mr-1 inline size-3" />
            <strong>
              {brokenSteps.length === 1
                ? `Step ${brokenSteps[0].stepOrder} uses a variable`
                : `${brokenSteps.length} steps use variables`}{" "}
              this app cannot fill
            </strong>{" "}
            —{" "}
            {[...new Set(brokenSteps.flatMap((s) => s.unknownVariables))]
              .map((v) => `{{${v}}}`)
              .join(", ")}
            . Recipients would see the braces, so the engine refuses those steps
            and holds the enrollments instead of sending. Editing the step fixes it
            for everyone at once.
          </p>
        </div>
      ) : null}

      {message ? (
        <div className="px-4 pb-2">
          <p
            className={cn(
              "rounded-md px-2.5 py-2 text-2xs",
              message.tone === "ok"
                ? "border border-info-border bg-info-subtle text-info-text"
                : "border border-danger-border bg-danger-subtle text-danger-text"
            )}
          >
            {message.text}
          </p>
        </div>
      ) : null}

      {expanded ? (
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="space-y-1">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted">Enrolled</p>
            <EnrollmentList sequenceId={sequence.id} />
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <MiniStat label="Mid-sequence" value={sequence.stats.active} />
            <MiniStat label="Finished" value={sequence.stats.completed} />
            <MiniStat
              label="Stopped early"
              value={sequence.stats.stopped}
              hint="Replied, suppressed, or no usable address"
            />
            <div className="rounded-md bg-surface-sunken px-2.5 py-1.5">
              <p className="text-2xs uppercase tracking-wider text-muted">Reply rate</p>
              <p className="text-sm font-semibold tabular text-primary">
                {sequence.stats.replyRate === null ? (
                  <Tooltip content="No one has been enrolled yet, so there is no rate to report. This is deliberately blank rather than 0%.">
                    <span className="cursor-help text-xs font-normal text-muted">
                      not measured
                    </span>
                  </Tooltip>
                ) : (
                  `${sequence.stats.replyRate}%`
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Rule
              on={sequence.stopOnReply}
              label="Stops when they reply"
              off="Keeps sending after a reply"
              warn={sequence.stopOnReply && !provider.canReceive}
              warnText="No mailbox is connected for reading replies, so this rule cannot be enforced automatically. Connect one in Settings → Email Accounts."
            />
            <Rule
              on={sequence.stopOnUnsubscribe}
              label="Stops on unsubscribe"
              off="Ignores unsubscribes"
            />
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-2 py-1 text-2xs text-secondary">
              <CalendarClock className="size-2.5" />
              Max {sequence.dailyCap}/day
            </span>
          </div>

          <ol className="flex flex-col gap-1.5">
            {sequence.steps.map((step) => (
              <li
                key={step.id}
                className="rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex size-4 items-center justify-center rounded-full bg-surface text-2xs font-semibold tabular text-secondary">
                    {step.stepOrder}
                  </span>
                  <span className="text-2xs text-muted">
                    {step.dayOffset === 0 ? "Immediately" : `Day ${step.dayOffset}`}
                  </span>
                  <span className="inline-flex items-center gap-1 text-2xs text-secondary">
                    {step.channel === "PHONE" ? (
                      <Phone className="size-2.5" />
                    ) : (
                      <Mail className="size-2.5" />
                    )}
                    {CHANNEL_LABEL[step.channel] ?? step.channel}
                  </span>
                  {step.isManualTask ? (
                    <Tooltip content="This step creates a task for a person rather than sending anything.">
                      <Badge variant="neutral" size="sm">
                        <Users className="size-2.5" />
                        Manual
                      </Badge>
                    </Tooltip>
                  ) : null}
                  {step.variables.length > 0 ? (
                    <span className="text-2xs text-muted">
                      {step.variables.map((v) => `{{${v}}}`).join(" ")}
                    </span>
                  ) : null}
                </div>
                {step.subject ? (
                  <p className="mt-1 text-2xs font-medium text-primary">{step.subject}</p>
                ) : null}
                <p className="mt-0.5 whitespace-pre-wrap text-2xs text-secondary">
                  {step.bodyTemplate}
                </p>
                {step.unknownVariables.length > 0 ? (
                  <p className="mt-1 text-2xs font-medium text-danger-text">
                    <AlertTriangle className="mr-0.5 inline size-2.5" />
                    {step.unknownVariables.map((v) => `{{${v}}}`).join(", ")} cannot be
                    filled — this step will not send.
                  </p>
                ) : null}
                {step.copyWarnings.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {step.copyWarnings.map((w) => (
                      <li key={w.code} className="text-2xs text-warning-text">
                        <Info className="mr-0.5 inline size-2.5" />
                        {w.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>

          {warnings.length > 0 ? (
            <p className="text-2xs text-muted">
              <Sparkles className="mr-0.5 inline size-2.5" />
              Copy notes are advisory — they never block a send. Judging the writing is your
              call; the engine only enforces consent and timing.
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  const body = (
    <div className="rounded-md bg-surface-sunken px-2.5 py-1.5">
      <p className="text-2xs uppercase tracking-wider text-muted">{label}</p>
      <p className="text-sm font-semibold tabular text-primary">{formatNumber(value)}</p>
    </div>
  );
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}

function Rule({
  on,
  label,
  off,
  warn,
  warnText,
}: {
  on: boolean;
  label: string;
  off: string;
  warn?: boolean;
  warnText?: string;
}) {
  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs",
        warn
          ? "bg-warning-surface text-warning-text"
          : on
            ? "bg-success-subtle text-success-text"
            : "bg-surface-sunken text-muted"
      )}
    >
      {warn ? (
        <AlertTriangle className="size-2.5" />
      ) : on ? (
        <Check className="size-2.5" />
      ) : (
        <Ban className="size-2.5" />
      )}
      {on ? label : off}
    </span>
  );
  return warn && warnText ? <Tooltip content={warnText}>{content}</Tooltip> : content;
}
