"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ListPlus, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatInrCompact, formatAge } from "@/lib/format";

type Clause = { text: string; count: number; href: string; tone: "neutral" | "good" | "risk" };

type Brief = {
  totalChanges: number;
  newSignals: number;
  newLeads: number;
  intentRisers: number;
  repliesNeedingYou: number;
  stalledCount: number;
  stalledValueInr: number;
  dueFollowUps: number;
  proposalViews: number;
  meetingsToday: number;
  clauses: Clause[];
  generatedAt: string;
};

/**
 * §6 — the morning brief. Assembled from counted facts, each of which links to
 * the query that produced it. No sentence here is generated prose; every clause
 * is a number with a destination, so "Show me" always resolves to real rows.
 */
export function CopilotBrief({
  greeting,
  firstName,
  brief,
  onStartSession,
}: {
  greeting: string;
  firstName: string;
  brief: Brief;
  onStartSession?: () => void;
}) {
  const nothingHappened = brief.clauses.length === 0;

  return (
    <section
      aria-labelledby="brief-heading"
      className="rounded-xl border border-ai-border bg-ai-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="brief-heading" className="text-lg font-semibold tracking-tight text-primary">
            {greeting}, {firstName}.
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted">
            <Sparkles className="size-3 text-ai-accent" />
            Assembled from your workspace {formatAge(brief.generatedAt)} · every figure links to its evidence
          </p>
        </div>
        <Badge variant="ai" size="lg" uppercase className="shrink-0">
          {brief.totalChanges} {brief.totalChanges === 1 ? "change" : "changes"}
        </Badge>
      </div>

      {nothingHappened ? (
        <p className="mt-3 text-sm leading-relaxed text-secondary">
          Nothing material changed since yesterday. No new signals, no replies waiting, nothing
          overdue. That is a real state, not a loading failure — your pipeline is quiet.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-secondary">
            {brief.totalChanges} meaningful {brief.totalChanges === 1 ? "change" : "changes"} since
            yesterday.{" "}
            {brief.clauses.map((c, i) => (
              <React.Fragment key={c.href + i}>
                <Link
                  href={c.href}
                  className={cn(
                    "font-medium underline decoration-dotted decoration-1 underline-offset-2 transition-colors",
                    c.tone === "risk"
                      ? "text-danger-text hover:decoration-solid"
                      : c.tone === "good"
                        ? "text-success-text hover:decoration-solid"
                        : "text-primary hover:decoration-solid"
                  )}
                >
                  {c.text}
                </Link>
                {i < brief.clauses.length - 2 ? ", " : i === brief.clauses.length - 2 ? " and " : "."}
              </React.Fragment>
            ))}
            {brief.stalledValueInr > 0 ? (
              <>
                {" "}
                That stalled pipeline is worth{" "}
                <Link
                  href="/pipeline"
                  className="font-semibold text-danger-text underline decoration-dotted decoration-1 underline-offset-2"
                >
                  {formatInrCompact(brief.stalledValueInr)}
                </Link>
                .
              </>
            ) : null}
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-ai-border pt-3 sm:grid-cols-4">
            {[
              ["New signals", brief.newSignals, "/leads?sort=surfaced"],
              ["New leads", brief.newLeads, "/leads?shortcut=fresh-today"],
              ["Replies waiting", brief.repliesNeedingYou, "/inbox"],
              ["Due today", brief.dueFollowUps, "/my-queue"],
            ].map(([label, value, href]) => (
              <div key={label as string}>
                <dt className="text-2xs uppercase tracking-wider text-muted">{label as string}</dt>
                <dd>
                  <Link
                    href={href as string}
                    className="text-base font-semibold text-primary tabular hover:text-brand-text"
                  >
                    {value as number}
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={onStartSession}>
          <Play />
          Start work session
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/my-queue">
            <ListPlus />
            Open my queue
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/leads?shortcut=hot-intent">
            Show hot leads
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </section>
  );
}
