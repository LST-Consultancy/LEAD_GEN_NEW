"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Info, Scan, Search, ShieldOff, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { api } from "@/lib/api/client";
import { formatNumber } from "@/lib/format";
import { TIER } from "@/lib/vocab";
import { ExternalLookup, RecentLookups } from "./external-lookup";
import type { leadLensReadiness } from "@/lib/services/lead-lens";

type Result = {
  query: string;
  kind: "name" | "domain" | "url" | "too_short";
  people: {
    id: string;
    name: string;
    headline: string | null;
    avatarUrl: string | null;
    linkedinUrl: string | null;
    title: string | null;
    company: { id: string; name: string; industry: string | null } | null;
    lead: { id: string; tier: string; intent: string; score: number | null } | null;
  }[];
  companies: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    city: string | null;
    employeeCount: number | null;
    intentScore: number;
    leadCount: number;
    signalCount: number;
  }[];
};

const KIND_LABEL: Record<string, string> = {
  name: "a name",
  domain: "a domain",
  url: "a LinkedIn URL",
};

export function LeadLensView({ readiness, initialQuery = "" }: { readiness: Awaited<ReturnType<typeof leadLensReadiness>>; initialQuery?: string }) {
  // Prefilled from a link (a lead's company); nothing runs until the person searches.
  const [q, setQ] = useState(initialQuery);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      setResult(await api.post<Result>("/api/lookup", { q }));
    } finally {
      setBusy(false);
    }
  };

  const found = result ? result.people.length + result.companies.length : 0;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Lead Lens</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Paste a name, a LinkedIn URL or a company domain and see everything this workspace
          already knows about them.
        </p>
      </div>

      <div className="rounded-lg border border-border px-3 py-2 text-xs text-secondary">
        <ShieldOff className="mr-1 inline size-3.5" />
        <strong className="text-primary">Look up first searches what you already hold.</strong>{" "}
        For a LinkedIn profile, company page or domain you can then look it up outside the workspace:
        profiles through {readiness.personProviders.length ? readiness.personProviders.join(" or ") : "SignalHire or Apollo (not connected)"}, companies through{" "}
        {readiness.companyReady ? "your Apify account" : "Apify (no token saved)"}. A bare name is searched in this workspace only.
      </div>

      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void run()}
                placeholder="Priya Menon · vaitarna.example · linkedin.com/in/…"
                className="pl-8 text-xs"
              />
            </div>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={q.trim().length < 2}
              onClick={() => void run()}
            >
              {!busy && <Scan />}
              Look up
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && result.kind !== "too_short" ? <ExternalLookup key={result.query} query={result.query} readiness={readiness} /> : null}
      {!result ? <RecentLookups recent={readiness.recent} /> : null}
      {result ? (
        <>
          <p className="text-2xs text-muted">
            <Info className="mr-0.5 inline size-2.5" />
            Read &ldquo;{result.query}&rdquo; as {KIND_LABEL[result.kind] ?? "a query"} and found{" "}
            {found} {found === 1 ? "match" : "matches"} in your workspace.
          </p>

          {found === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Scan className="mx-auto size-5 text-muted" />
                <p className="mt-2 text-xs font-medium text-primary">Nothing here yet</p>
                <p className="mx-auto mt-1 max-w-md text-2xs text-secondary">
                  Nobody matching that is in this workspace. With no data provider connected there
                  is nothing to enrich from, so the honest answer is that we do not know — not
                  that there is nothing to know.
                </p>
                <Link
                  href="/find-leads"
                  className="mt-2 inline-block text-2xs text-accent-text hover:underline"
                >
                  Import a list instead →
                </Link>
              </CardContent>
            </Card>
          ) : null}

          {result.people.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <User className="mr-1 inline size-3.5" />
                  People
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border-subtle">
                  {result.people.map((p) => (
                    <li key={p.id} className="flex items-start gap-2.5 px-4 py-2.5">
                      <Avatar name={p.name} src={p.avatarUrl ?? undefined} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium text-primary">{p.name}</span>
                          {p.lead ? (
                            <Link href={`/leads/${p.lead.id}`}>
                              <Badge variant="neutral" size="sm">
                                <span className={TIER[p.lead.tier as "A"]?.chip}>
                                  Tier {p.lead.tier}
                                </span>
                                {p.lead.score !== null ? (
                                  <span className="ml-1 tabular">{p.lead.score}</span>
                                ) : null}
                              </Badge>
                            </Link>
                          ) : (
                            <Badge variant="neutral" size="sm">
                              Not a lead
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-2xs text-secondary">
                          {[p.title, p.company?.name, p.company?.industry, p.headline]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {p.lead ? (
                        <Link
                          href={`/leads/${p.lead.id}`}
                          className="shrink-0 text-2xs text-accent-text hover:underline"
                        >
                          Open dossier →
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {result.companies.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <Building2 className="mr-1 inline size-3.5" />
                  Companies
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border-subtle">
                  {result.companies.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline gap-2 px-4 py-2.5">
                      <span className="text-xs font-medium text-primary">{c.name}</span>
                      <span className="min-w-0 flex-1 text-2xs text-secondary">
                        {[
                          c.industry,
                          c.city,
                          c.employeeCount ? `${formatNumber(c.employeeCount)} staff` : null,
                          c.domain,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="text-2xs text-muted">
                        {c.leadCount} leads · {c.signalCount} signals
                        {c.intentScore > 0 ? ` · intent ${c.intentScore}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
