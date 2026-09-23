"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  ExternalLink,
  Info,
  Lightbulb,
  Moon,
  Pin,
  Play,
  Sparkles,
  StickyNote as StickyNoteIcon,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import { RISK_CLASS, AUTOPILOT_MODE } from "@/lib/vocab";
import { formatAge, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Coach = {
  id: string;
  title: string;
  body: string;
  whyNow: string | null;
  evidence: unknown;
  confidence: number;
  createdAt: string;
};

/** §13 — one specific, data-derived recommendation. Never a platitude. */
export function AiSalesCoach({ coach }: { coach: Coach | null }) {
  if (!coach) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Lightbulb className="size-3.5 text-ai-accent" />
            Sales coach
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs leading-relaxed text-secondary">
            Not enough of your own data yet to say something useful. The coach compares your sent
            messages against replies received — it needs a few weeks of real activity before its
            advice beats generic advice.
          </p>
        </CardContent>
      </Card>
    );
  }

  const evidence = Array.isArray(coach.evidence)
    ? (coach.evidence as { label: string; detail?: string; href?: string }[])
    : [];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <Lightbulb className="size-3.5 text-ai-accent" />
            Sales coach
          </CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            From your workspace data · {coach.confidence}% confidence
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <p className="text-xs font-semibold text-primary">{coach.title}</p>
        <p className="text-xs leading-relaxed text-secondary">{coach.body}</p>

        {coach.whyNow ? (
          <p className="flex gap-1.5 rounded-md bg-surface-sunken px-2.5 py-2 text-2xs leading-relaxed text-secondary">
            <Info className="mt-0.5 size-3 shrink-0 text-muted" />
            <span>
              <span className="font-semibold">Why now?</span> {coach.whyNow}
            </span>
          </p>
        ) : null}

        {evidence.length > 0 ? (
          <ul className="space-y-1 border-t border-border-subtle pt-2">
            {evidence.map((e, i) => (
              <li key={i} className="text-2xs">
                {e.href ? (
                  <Link href={e.href} className="text-brand-text hover:underline">
                    {e.label}
                  </Link>
                ) : (
                  <span className="text-muted">{e.label}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

type DailyBrief = {
  id: string;
  title: string;
  body: string;
  evidence: unknown;
  createdAt: string;
};

/**
 * §6 — the AI complement to the deterministic Copilot brief above it. That
 * brief is counted facts with no generated prose by design; this is the one
 * sentence of prose that says which of those facts to act on first. Absent on
 * a quiet day, deliberately — there is nothing to prioritise.
 */
export function AiDailyPriority({ brief }: { brief: DailyBrief | null }) {
  if (!brief) return null;

  const evidence = Array.isArray(brief.evidence)
    ? (brief.evidence as { label: string; href?: string }[])
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-ai-accent" />
          Start here
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs font-semibold text-primary">{brief.title}</p>
        <p className="text-xs leading-relaxed text-secondary">{brief.body}</p>
        {evidence.length > 0 ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border-subtle pt-2">
            {evidence.map((e, i) =>
              e.href ? (
                <li key={i}>
                  <Link href={e.href} className="text-2xs text-brand-text hover:underline">
                    {e.label}
                  </Link>
                </li>
              ) : (
                <li key={i} className="text-2xs text-muted">
                  {e.label}
                </li>
              )
            )}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

type Digest = {
  runCount: number;
  mode: string;
  leadsFound: number;
  contactsRevealed: number;
  messagesDrafted: number;
  messagesSent: number;
  pointsSpent: number;
  needsReviewCount: number;
  lastRunAt: string;
  log: {
    id: string;
    at: string;
    agent: string;
    tool: string;
    riskClass: string;
    summary: string;
    state: string;
    pointsSpent: number;
    requiresApproval: boolean;
  }[];
};

/** §44 / §43 — what ran overnight, and the auditable log behind the summary. */
export function WhileYouSlept({ digest }: { digest: Digest | null }) {
  const [showLog, setShowLog] = React.useState(false);

  if (!digest) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Moon className="size-3.5" />
            While you slept
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            compact
            icon={Bot}
            title="Autopilot didn't run"
            description="No agent activity in the last 24 hours. Turn Autopilot on to have prospecting and research happen before you open the app."
            action={
              <Button size="sm" variant="secondary" asChild>
                <Link href="/autopilot">Configure Autopilot</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const mode = AUTOPILOT_MODE[digest.mode] ?? AUTOPILOT_MODE.OFF;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <Moon className="size-3.5" />
            While you slept
          </CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            {digest.runCount} {digest.runCount === 1 ? "run" : "runs"} · last {formatAge(digest.lastRunAt)}
          </p>
        </div>
        <Tooltip content={mode.description}>
          <Badge variant={digest.mode === "FULL_AUTO" ? "success" : "warning"} size="lg" uppercase>
            {mode.short}
          </Badge>
        </Tooltip>
      </CardHeader>

      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {[
            ["Leads found", digest.leadsFound],
            ["Contacts revealed", digest.contactsRevealed],
            ["Messages drafted", digest.messagesDrafted],
            ["Messages sent", digest.messagesSent],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-2xs uppercase tracking-wider text-muted">{label as string}</dt>
              <dd className="text-sm font-semibold text-primary tabular">{value as number}</dd>
            </div>
          ))}
        </dl>

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2.5">
          <span className="text-2xs text-muted">
            {digest.pointsSpent} {digest.pointsSpent === 1 ? "point" : "points"} spent
          </span>
          {digest.needsReviewCount > 0 ? (
            <Button variant="primary" size="xs" asChild>
              <Link href="/approvals">
                <AlertTriangle />
                {digest.needsReviewCount} awaiting you
              </Link>
            </Button>
          ) : (
            <span className="text-2xs text-success-text">Nothing needs approval</span>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setShowLog(!showLog)}
          aria-expanded={showLog}
        >
          {showLog ? "Hide" : "Show"} run log ({digest.log.length} actions)
        </Button>

        {showLog ? (
          <ol className="space-y-0 rounded-md border border-border-subtle bg-surface-sunken animate-in-up">
            {digest.log.map((entry, i) => {
              const risk = RISK_CLASS[entry.riskClass] ?? RISK_CLASS.READ;
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "flex gap-2 px-2.5 py-2",
                    i > 0 && "border-t border-border-subtle"
                  )}
                >
                  <span className="w-10 shrink-0 font-mono text-2xs text-muted tabular">
                    {formatTime(entry.at)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-2xs leading-relaxed text-secondary">
                      {entry.summary}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span className="font-mono text-2xs text-muted">{entry.tool}</span>
                      <Badge size="sm" variant={risk.variant}>
                        {risk.label}
                      </Badge>
                      {entry.pointsSpent > 0 ? (
                        <span className="text-2xs text-warning-text tabular">
                          −{entry.pointsSpent}
                        </span>
                      ) : null}
                      {entry.requiresApproval ? (
                        <Badge size="sm" variant="warning" uppercase>
                          Held
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </CardContent>
    </Card>
  );
}

type Note = {
  id: string;
  kind: string;
  body: string;
  color: string;
  isPinned: boolean;
  updatedAt: string;
};

const NOTE_COLOR: Record<string, string> = {
  amber: "border-warning-border bg-warning-subtle",
  teal: "border-brand-border bg-brand-subtle",
  rose: "border-danger-border bg-danger-subtle",
  sky: "border-info-border bg-info-subtle",
  violet: "border-border bg-surface-sunken",
};

/** §16 — workspace-level personal notes. */
export function StickyNotes({ notes }: { notes: Note[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <StickyNoteIcon className="size-3.5" />
          Notes to self
        </CardTitle>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => toast("Note composer lands with the notes surface")}
        >
          Add
        </Button>
      </CardHeader>
      <CardContent>
        {notes.length === 0 ? (
          <EmptyState
            compact
            icon={StickyNoteIcon}
            title="No notes yet"
            description="Keep the things you'd otherwise write on a Post-it — objections you keep hearing, a promise you made, a reminder for a specific account."
          />
        ) : (
          <ul className="space-y-1.5">
            {notes.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "rounded-md border px-2.5 py-2",
                  NOTE_COLOR[n.color] ?? NOTE_COLOR.violet
                )}
              >
                <div className="flex items-start gap-1.5">
                  {n.isPinned ? (
                    <Pin className="mt-0.5 size-3 shrink-0 rotate-45 text-muted" aria-label="Pinned" />
                  ) : null}
                  <p className="flex-1 text-2xs leading-relaxed text-primary">{n.body}</p>
                </div>
                <p className="mt-1 text-2xs uppercase tracking-wider text-muted">
                  {n.kind.replace("_", " ").toLowerCase()} · {formatAge(n.updatedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** §15 — the 60-second audio briefing. Honest about not being wired up. */
export function MorningBriefing({ changes }: { changes: number }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <Play className="size-3.5" />
            60-second briefing
          </CardTitle>
          <p className="mt-0.5 text-2xs text-muted">English, Hindi, Marathi, Tamil, Telugu, Gujarati</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="rounded-md border border-dashed border-border-strong bg-surface-sunken px-3 py-2.5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
            Audio not configured
          </p>
          <p className="mt-1 text-xs leading-relaxed text-secondary">
            Generating speech needs a text-to-speech provider key. The transcript below is real — it
            is assembled from the same counted facts as your brief.
          </p>
        </div>

        <details className="group">
          <summary className="cursor-pointer text-2xs font-medium text-brand-text hover:underline">
            Read the transcript instead
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-secondary">
            Good morning. {changes} {changes === 1 ? "thing" : "things"} changed since yesterday. The
            full breakdown is at the top of this screen, with a link behind every number. Nothing in
            this transcript is generated prose — it counts the same rows the brief counts.
          </p>
        </details>

        <Button variant="secondary" size="sm" className="w-full" asChild>
          <Link href="/settings/ai">
            <ExternalLink />
            Configure voice provider
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** §14 — India Demand Index. Requires the ingestion pipeline, so it says so. */
export function DemandIndexTeaser() {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-ai-accent" />
            India Demand Index
          </CardTitle>
          <p className="mt-0.5 text-2xs text-muted">Trending buyer demand by category and city</p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-dashed border-border-strong bg-surface-sunken p-3">
          <p className="text-xs leading-relaxed text-secondary">
            This module reports demand velocity across industries, services and cities. It needs
            enough ingested signal volume to compute a trend that means anything — showing movement
            percentages from a demo dataset would be a fabricated metric, so it stays empty until the
            ingestion pipeline is live.
          </p>
          <Button variant="ghost" size="sm" className="mt-2 w-full" asChild>
            <Link href="/live-demand">
              See what it will show
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
