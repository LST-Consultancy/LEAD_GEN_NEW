"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Brain,
  Building2,
  Clock,
  ExternalLink,
  GitBranch,
  ListChecks,
  Sparkles,
  StickyNote,
  Target,
  TrendingUp,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { formatAge, formatDate, formatInrCompact, isPast } from "@/lib/format";
import { AddNote, CreateDealDialog } from "@/components/leads/dossier/lead-actions";
import { TASK_PRIORITY } from "@/lib/vocab";
import { cn } from "@/lib/utils";

/** §113 — ranked candidate actions, each with its reasoning. */
export function NextBestActions({
  actions,
}: {
  actions: {
    id: string;
    action: string;
    label: string;
    rationale: string;
    rank: number;
    score: number;
    channel: string | null;
    expectedImpactInr: number | null;
  }[];
}) {
  if (actions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-ai-accent" />
            Next best action
          </CardTitle>
          <p className="mt-0.5 text-2xs text-muted">Ranked candidates, not a single instruction</p>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {actions.map((a, i) => (
            <li
              key={a.id}
              className={cn(
                "rounded-md border px-2.5 py-2",
                i === 0 ? "border-brand-border bg-brand-subtle" : "border-border-subtle bg-surface"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    i === 0 ? "text-brand-text" : "text-primary"
                  )}
                >
                  {a.label}
                </span>
                <Tooltip content="Relative confidence that this is the right next move.">
                  <span className="cursor-help text-2xs font-medium text-muted tabular">
                    {a.score}
                  </span>
                </Tooltip>
              </div>
              <p
                className={cn(
                  "mt-0.5 text-2xs leading-relaxed",
                  i === 0 ? "text-brand-text/90" : "text-secondary"
                )}
              >
                {a.rationale}
              </p>
              {a.expectedImpactInr ? (
                <p className="mt-1 text-2xs text-muted">
                  Influences {formatInrCompact(a.expectedImpactInr)}
                </p>
              ) : null}
              {i === 0 ? (
                <div className="mt-1.5 flex gap-1.5">
                  <Button
                    variant="primary"
                    size="xs"
                    onClick={() => toast("Action execution lands in Phase 4")}
                  >
                    Do it
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      toast("Feedback recorded locally", {
                        description:
                          "The schema stores accept/reject per recommendation to improve future ranking.",
                      })
                    }
                  >
                    Not this
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** §114 — structured relationship memory, so outreach can reference reality. */
export function RelationshipMemory({
  memory,
}: {
  memory: { id: string; kind: string; content: string; sourceType: string; confidence: number; createdAt: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <Brain className="size-3.5" />
            Relationship memory
          </CardTitle>
          <p className="mt-0.5 text-2xs text-muted">What we know about working with this person</p>
        </div>
      </CardHeader>
      <CardContent>
        {memory.length === 0 ? (
          <EmptyState
            compact
            icon={Brain}
            title="Nothing recorded yet"
            description="Preferences, concerns, objections and promises get stored here so drafts can reference them instead of inventing familiarity."
          />
        ) : (
          <ul className="space-y-1.5">
            {memory.map((m) => (
              <li key={m.id} className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <Badge size="sm" variant="neutral" uppercase>
                    {m.kind}
                  </Badge>
                  <span className="text-2xs text-muted">
                    from {m.sourceType} · {m.confidence}% · {formatAge(m.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-2xs leading-relaxed text-secondary">{m.content}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Deals attached to this lead, with their risk flags. */
export function DealsPanel({
  leadId,
  companyName,
  deals,
}: {
  leadId: string;
  companyName: string;
  deals: {
    id: string;
    title: string;
    valueInr: number;
    status: string;
    confidence: number;
    stage: { name: string; probability: number };
    stageEnteredAt: string;
    expectedCloseAt: string | null;
    nextActionLabel: string | null;
    nextActionAt: string | null;
    lostReason: string | null;
    risks: { code: string; severity: string; title: string; explanation: string; suggestedAction: string | null }[];
  }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <GitBranch className="size-3.5" />
          Deals
        </CardTitle>
        <Button variant="ghost" size="xs" asChild>
          <Link href="/pipeline">Pipeline</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {deals.length === 0 ? (
          <EmptyState
            compact
            icon={GitBranch}
            title="No deal yet"
            description="Create a deal once there is a real opportunity to track. A lead without a deal costs nothing to keep."
            action={<CreateDealDialog leadId={leadId} companyName={companyName} />}
          />
        ) : (
          <ul className="space-y-2">
            {deals.map((d) => (
              <li key={d.id} className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-medium text-primary">{d.title}</p>
                  <span className="shrink-0 text-xs font-semibold text-primary tabular">
                    {formatInrCompact(d.valueInr)}
                  </span>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge
                    size="sm"
                    variant={d.status === "WON" ? "success" : d.status === "LOST" ? "danger" : "brand"}
                  >
                    {d.stage.name}
                  </Badge>
                  <span className="text-2xs text-muted">
                    {d.stage.probability}% stage probability · {d.confidence}% owner confidence
                  </span>
                </div>

                <p className="mt-1 text-2xs text-muted">
                  In this stage {formatAge(d.stageEnteredAt).replace(" ago", "")}
                  {d.expectedCloseAt ? ` · expected ${formatDate(d.expectedCloseAt)}` : ""}
                </p>

                {d.nextActionLabel ? (
                  <p className="mt-1 flex items-center gap-1 text-2xs text-secondary">
                    <Clock className="size-2.5" />
                    {d.nextActionLabel}
                    {d.nextActionAt ? ` · ${formatAge(d.nextActionAt)}` : ""}
                  </p>
                ) : d.status === "OPEN" ? (
                  <p className="mt-1 text-2xs text-warning-text">No next action scheduled</p>
                ) : null}

                {d.lostReason ? (
                  <p className="mt-1 rounded bg-danger-subtle px-2 py-1 text-2xs text-danger-text">
                    Lost: {d.lostReason}
                  </p>
                ) : null}

                {d.risks.length > 0 ? (
                  <ul className="mt-1.5 space-y-1 border-t border-border-subtle pt-1.5">
                    {d.risks.map((r) => (
                      <li key={r.code} className="text-2xs">
                        <span
                          className={cn(
                            "font-semibold",
                            r.severity === "high" ? "text-danger-text" : "text-warning-text"
                          )}
                        >
                          {r.title}
                        </span>
                        <span className="block leading-relaxed text-muted">{r.explanation}</span>
                        {r.suggestedAction ? (
                          <span className="block leading-relaxed text-secondary">
                            → {r.suggestedAction}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Tasks and notes, side by side in one card to save vertical space. */
export function TasksAndNotes({
  tasks,
  notes,
  leadId,
}: {
  leadId?: string;
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt: string | null;
    priorityReason: string | null;
    owner: { name: string } | null;
    createdByAi: boolean;
  }[];
  notes: {
    id: string;
    body: string;
    author: { name: string; avatarUrl: string | null } | null;
    createdAt: string;
  }[];
}) {
  const [tab, setTab] = React.useState<"tasks" | "notes">(tasks.length > 0 ? "tasks" : "notes");

  return (
    <Card>
      <CardHeader className="items-center">
        <div
          className="flex items-center gap-0.5 rounded-md border border-border bg-surface-sunken p-0.5"
          role="group"
          aria-label="Tasks or notes"
        >
          {(
            [
              ["tasks", `Tasks (${tasks.length})`],
              ["notes", `Notes (${notes.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={cn(
                "rounded px-2 py-0.5 text-2xs font-medium transition-colors",
                tab === key ? "bg-surface text-primary shadow-card" : "text-muted hover:text-secondary"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "notes" && leadId ? (
          <AddNote leadId={leadId} />
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => toast("Task creation from here lands with My Queue")}
          >
            Add
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {tab === "tasks" ? (
          tasks.length === 0 ? (
            <EmptyState
              compact
              icon={ListChecks}
              title="No tasks"
              description="Tasks appear automatically when a reply arrives, a deal stalls, or a follow-up comes due."
            />
          ) : (
            <ul className="space-y-1.5">
              {tasks.map((t) => {
                const priority = TASK_PRIORITY[t.priority] ?? TASK_PRIORITY.MEDIUM;
                const overdue = isPast(t.dueAt);
                return (
                  <li
                    key={t.id}
                    className="rounded-md border border-border-subtle bg-surface px-2.5 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          t.status === "DONE" ? "text-muted line-through" : "text-primary"
                        )}
                      >
                        {t.title}
                      </span>
                      <Badge size="sm" variant={priority.variant} uppercase>
                        {priority.label}
                      </Badge>
                      {t.createdByAi ? (
                        <Badge size="sm" variant="ai" uppercase>
                          Auto
                        </Badge>
                      ) : null}
                    </div>
                    {t.priorityReason ? (
                      <p className="mt-0.5 text-2xs leading-relaxed text-muted">{t.priorityReason}</p>
                    ) : null}
                    <p className="mt-0.5 text-2xs text-muted">
                      {t.owner ? `${t.owner.name} · ` : ""}
                      {t.dueAt ? (
                        <span className={overdue ? "text-danger-text" : undefined}>
                          due {formatAge(t.dueAt)}
                        </span>
                      ) : (
                        "no due date"
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          )
        ) : notes.length === 0 ? (
          <EmptyState
            compact
            icon={StickyNote}
            title="No notes"
            description="Record what you learn on calls — preferences, blockers, who really signs. Drafts read from these."
          />
        ) : (
          <ul className="space-y-1.5">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
                <p className="text-2xs leading-relaxed text-secondary">{n.body}</p>
                <p className="mt-1 flex items-center gap-1.5 text-2xs text-muted">
                  {n.author ? (
                    <>
                      <Avatar name={n.author.name} src={n.author.avatarUrl} size="xs" />
                      {n.author.name}
                    </>
                  ) : (
                    "Unknown author"
                  )}
                  · {formatAge(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Company context and account-level intent, with its derivation shown. */
export function CompanyPanel({
  company,
  sourcePhrase,
  icpProfile,
  lists,
}: {
  company: {
    id: string;
    name: string;
    description: string | null;
    industry: string | null;
    subIndustry: string | null;
    employeeBand: string | null;
    revenueBandInr: string | null;
    foundedYear: number | null;
    location: string;
    technologies: string[];
    intentScore: number;
    intentScoreReason: unknown;
    lastSignalAt: string | null;
    website: string | null;
  };
  sourcePhrase: { id: string; phrase: string; sourceKind: string } | null;
  icpProfile: { id: string; name: string } | null;
  lists: { id: string; name: string; color: string | null }[];
}) {
  const reason = company.intentScoreReason as
    | { method?: string; strongestLeadScore?: number; averageLeadScore?: number; leadsConsidered?: number; note?: string }
    | null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Building2 className="size-3.5" />
          Account context
        </CardTitle>
        <Button variant="ghost" size="xs" asChild>
          <Link href={`/accounts/${company.id}`}>
            Account
            <ExternalLink />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {company.description ? (
          <p className="text-2xs leading-relaxed text-secondary">{company.description}</p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {[
            ["Industry", company.subIndustry ?? company.industry],
            ["Location", company.location],
            ["Headcount", company.employeeBand],
            ["Revenue band", company.revenueBandInr],
            ["Founded", company.foundedYear?.toString()],
          ]
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div key={label as string} className="min-w-0">
                <dt className="truncate text-2xs uppercase tracking-wider text-muted">
                  {label as string}
                </dt>
                <dd className="truncate text-2xs text-secondary">{value as string}</dd>
              </div>
            ))}
        </dl>

        {company.technologies.length > 0 ? (
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
              Technology stack
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {company.technologies.map((t) => (
                <span
                  key={t}
                  className="rounded border border-border-subtle bg-surface-sunken px-1 text-2xs text-secondary"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* §59 — account intent, with the arithmetic exposed */}
        <div className="border-t border-border-subtle pt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-muted">
              <TrendingUp className="size-3" />
              Account intent
            </p>
            <span className="text-xs font-semibold text-primary tabular">
              {company.intentScore}/100
            </span>
          </div>
          <Progress
            value={company.intentScore}
            size="xs"
            className="mt-1.5"
            label={`Account intent: ${company.intentScore} of 100`}
          />
          {reason?.method ? (
            <p className="mt-1.5 text-2xs leading-relaxed text-muted">
              {reason.method}. Strongest lead {reason.strongestLeadScore}, average{" "}
              {reason.averageLeadScore}, across {reason.leadsConsidered}{" "}
              {reason.leadsConsidered === 1 ? "lead" : "leads"}.
            </p>
          ) : null}
          {company.lastSignalAt ? (
            <p className="mt-0.5 text-2xs text-muted">
              Last signal at this account {formatAge(company.lastSignalAt)}
            </p>
          ) : null}
        </div>

        {/* Provenance: which phrase and which ICP produced this lead */}
        <div className="space-y-1.5 border-t border-border-subtle pt-2.5">
          {sourcePhrase ? (
            <div>
              <p className="text-2xs uppercase tracking-wider text-muted">Found by</p>
              <Link
                href="/settings/search-phrases"
                className="text-2xs text-brand-text hover:underline"
              >
                “{sourcePhrase.phrase}”
              </Link>
            </div>
          ) : null}
          {icpProfile ? (
            <div>
              <p className="text-2xs uppercase tracking-wider text-muted">Scored against</p>
              <Link href="/settings/icp" className="text-2xs text-brand-text hover:underline">
                <Target className="mr-0.5 inline size-2.5" />
                {icpProfile.name}
              </Link>
            </div>
          ) : null}
          {lists.length > 0 ? (
            <div>
              <p className="text-2xs uppercase tracking-wider text-muted">In lists</p>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {lists.map((l) => (
                  <Badge key={l.id} size="sm" variant="neutral">
                    {l.name}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>

      <CardFooter>
        <Button
          variant="ai"
          size="sm"
          className="w-full"
          onClick={() =>
            toast("Deep research needs an AI provider key", {
              description:
                "It would cost 2 points and return cited person, company, opportunity and outreach sections. Nothing was charged.",
            })
          }
        >
          <Brain />
          Deep research · 2 points
        </Button>
      </CardFooter>
    </Card>
  );
}
