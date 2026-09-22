"use client";

import * as React from "react";
import Link from "next/link";
import { Brain, ExternalLink, Info, Lock, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatAge, formatNumber } from "@/lib/format";
import type { InternalDossier, ResearchCapability } from "@/lib/services/research";

type LeadOption = { id: string; companyName: string; personName: string; score: number };

/**
 * §66 — research.
 *
 * The screen is split because the two halves have different truth conditions.
 * What the workspace already knows is a lookup, and every line cites its row.
 * Deep external research is not built, and says exactly what it would need —
 * rather than generating a confident paragraph with nothing behind it.
 */
export function ResearchView({
  capability,
  reports,
  leads,
}: {
  capability: ResearchCapability;
  reports: {
    id: string;
    state: string;
    companyName: string;
    startedAt: string;
    confidence: number;
  }[];
  leads: LeadOption[];
}) {
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<LeadOption | null>(null);
  const [dossier, setDossier] = React.useState<InternalDossier | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const matches = query.trim()
    ? leads
        .filter(
          (l) =>
            l.companyName.toLowerCase().includes(query.toLowerCase()) ||
            l.personName.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 8)
    : [];

  async function open(lead: LeadOption) {
    setSelected(lead);
    setQuery("");
    setBusy(true);
    setError(null);
    setDossier(null);
    try {
      const res = await fetch(`/api/research/${lead.id}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      setDossier((await res.json()) as InternalDossier);
    } catch {
      setError("That account couldn't be read. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Research</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Everything this workspace already knows about an account, each line citing the record it
          came from. Nothing here is generated — it is read.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Search className="size-3.5 text-muted" />
            Look up an account
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="relative max-w-md">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Company or contact name…"
              aria-label="Search accounts"
            />
            {matches.length ? (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg">
                {matches.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => void open(l)}
                      className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs text-secondary transition-colors hover:bg-brand-subtle hover:text-primary"
                    >
                      <span className="truncate">
                        {l.companyName}
                        <span className="ml-1.5 text-muted">{l.personName}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-2xs text-muted">
                        {l.score.toFixed(1)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {busy ? <p className="mt-3 text-xs text-muted">Reading your records…</p> : null}
          {error ? <ErrorState compact title="Couldn't read that account" description={error} /> : null}
        </CardContent>
      </Card>

      {dossier ? <Dossier dossier={dossier} /> : null}

      {!dossier && !busy ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              icon={Brain}
              title={selected ? "Nothing found for that account" : "Pick an account to start"}
              description="Search above. The dossier is assembled from your own rows — company details, contacts, signals, deals and your team's notes — with each line naming where it came from."
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Lock className="size-3.5 text-muted" />
            Deep external research
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {capability.externalAvailable ? (
            <p className="text-2xs text-secondary">
              A licensed source and a model are both connected, so a deep report can be run.
            </p>
          ) : (
            <>
              <div className="flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-2.5 text-2xs leading-relaxed text-warning-text">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Not available. It needs {capability.missing.join(", and ")}. Rather than generate
                  a dossier from a model&apos;s recollection — which reads exactly like a researched
                  one and cannot be checked — this stays switched off. No points are charged and
                  nothing is queued.
                </span>
              </div>
              <p className="text-2xs leading-relaxed text-muted">
                Working sources today: {capability.sourcesConfigured.join(", ") || "none"}. Each of
                the rest needs its own authorised access — this product does not scrape pages that
                forbid it, so a source without a contract or an official API stays unavailable.
              </p>
              <ul className="space-y-0.5">
                {capability.sourcesUnconfigured.map((s) => (
                  <li key={s.label} className="text-2xs text-muted">
                    <span className="text-secondary">{s.label}</span> — {s.requires}
                  </li>
                ))}
              </ul>
            </>
          )}

          {reports.length ? (
            <div className="space-y-1 pt-1">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                Past reports
              </p>
              {reports.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-2xs">
                  <span className="text-primary">{r.companyName}</span>
                  <Badge size="sm" variant="neutral">
                    {r.state}
                  </Badge>
                  <span className="text-muted">{formatAge(r.startedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="pt-1 text-2xs text-muted">No deep report has ever been run here.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Dossier({ dossier }: { dossier: InternalDossier }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>{dossier.lead.companyName}</CardTitle>
        <div className="flex items-center gap-2 text-2xs text-muted">
          <span className="tabular-nums">score {dossier.lead.score.toFixed(1)}</span>
          <span>·</span>
          <span>
            {formatNumber(dossier.factCount)} recorded{" "}
            {dossier.factCount === 1 ? "fact" : "facts"}
          </span>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/leads/${dossier.lead.id}`}>
              Open lead
              <ExternalLink />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {dossier.sections.map((section) => (
          <div key={section.key}>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
              {section.title}
            </p>
            {section.facts.length === 0 ? (
              <p className="text-2xs italic leading-relaxed text-muted">{section.emptyMeans}</p>
            ) : (
              <ul className="space-y-1">
                {section.facts.map((fact, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-2xs">
                    <span className="font-medium text-primary">{fact.label}</span>
                    {fact.value ? <span className="text-secondary">{fact.value}</span> : null}
                    <span className="text-muted">
                      —{" "}
                      {fact.href ? (
                        <Link
                          href={fact.href}
                          className="text-brand-text underline-offset-2 hover:underline"
                        >
                          {fact.source}
                        </Link>
                      ) : (
                        fact.source
                      )}
                      {fact.asOf ? `, ${formatAge(fact.asOf)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
