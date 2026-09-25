"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, Search, ShieldOff, Unlock, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { TIER } from "@/lib/vocab";

type Row = {
  personId: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  title: string;
  department: string | null;
  seniority: string | null;
  isDecisionMaker: boolean;
  company: {
    id: string;
    name: string;
    industry: string | null;
    city: string | null;
    state: string | null;
    employeeCount: number | null;
    intentScore: number;
  };
  lead: { id: string; tier: string; intent: string; status: string; score: number | null } | null;
  contacts: { revealed: number; locked: number; optedOut: boolean };
};

type Facets = {
  seniorities: { value: string; count: number }[];
  departments: { value: string; count: number }[];
  industries: { value: string; count: number }[];
  states: { value: string; count: number }[];
};

type Result = { rows: Row[]; examined: number; scope: string; externalSearchAvailable: boolean };

export function PeopleFinderView({
  initial,
  facets,
}: {
  initial: Result;
  facets: Facets;
}) {
  const [result, setResult] = useState(initial);
  const [q, setQ] = useState("");
  const [seniority, setSeniority] = useState<Set<string>>(new Set());
  const [industry, setIndustry] = useState<Set<string>>(new Set());
  const [attachment, setAttachment] = useState<"any" | "is_lead" | "not_lead">("any");
  const [decisionMakersOnly, setDecisionMakersOnly] = useState(false);
  const [origin, setOrigin] = useState<"any" | "post_author" | "enrichment" | "lookup" | "import">("any");
  const [buyerSide, setBuyerSide] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [withinDays, setWithinDays] = useState(90);
  const [busy, setBusy] = useState(false);

  const run = async (over: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      setResult(
        await api.post<Result>("/api/people", {
          q: q || undefined,
          seniority: [...seniority],
          industry: [...industry],
          attachment,
          decisionMakersOnly,
          origin,
          buyerSide,
          switching,
          withinDays,
          ...over,
        })
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = (
    set: Set<string>,
    setter: (s: Set<string>) => void,
    value: string
  ) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">People Finder</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Search across roles, seniority, industry and intent.
        </p>
      </div>

      {!result.externalSearchAvailable ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-text">
          <ShieldOff className="mr-1 inline size-3.5" />
          <strong>This searches your workspace only.</strong> No discovery source is connected, so
          it cannot find people you do not already hold. Connecting one is what turns this from a
          filter over your own data into a prospecting tool.
        </div>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void run()}
                placeholder="Name, job title or company"
                className="pl-8 text-xs"
              />
            </div>
            <Button size="sm" variant="primary" loading={busy} onClick={() => void run()}>
              {!busy && <Search />}
              Search
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <FilterGroup
              label="Seniority"
              options={facets.seniorities}
              selected={seniority}
              onToggle={(v) => toggle(seniority, setSeniority, v)}
            />
            <FilterGroup
              label="Industry"
              options={facets.industries.slice(0, 8)}
              selected={industry}
              onToggle={(v) => toggle(industry, setIndustry, v)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              {(
                [
                  ["any", "Everyone"],
                  ["not_lead", "Not yet a lead"],
                  ["is_lead", "Already a lead"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAttachment(k)}
                  className={cn(
                    "rounded-md px-2 py-1 text-2xs transition-colors duration-150",
                    attachment === k
                      ? "bg-accent-subtle font-medium text-accent-text"
                      : "bg-surface-sunken text-muted hover:bg-surface-hover"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-2xs text-secondary">
              <Checkbox
                checked={decisionMakersOnly}
                onCheckedChange={(v) => setDecisionMakersOnly(Boolean(v))}
              />
              Decision makers only
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-2xs text-secondary">
            <label className="flex items-center gap-1.5">Came from
              <select aria-label="Came from" value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)} className="rounded border border-border bg-surface px-1.5 py-0.5">
                <option value="any">Anywhere</option>
                <option value="post_author">Wrote an opportunity&apos;s post</option>
                <option value="enrichment">Found by enrichment</option>
                <option value="lookup">Lead Lens lookup</option>
                <option value="import">Imported or added by hand</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5"><Checkbox checked={buyerSide} onCheckedChange={(v) => setBuyerSide(Boolean(v))} />Company is asking for a provider</label>
            <label className="flex items-center gap-1.5"><Checkbox checked={switching} onCheckedChange={(v) => setSwitching(Boolean(v))} />Company is switching (migration or technology change)</label>
            {(buyerSide || switching) && <label className="flex items-center gap-1.5">seen in the last
              <select aria-label="Evidence window" value={withinDays} onChange={(e) => setWithinDays(Number(e.target.value))} className="rounded border border-border bg-surface px-1.5 py-0.5">{[7, 30, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}</select>
            </label>}
          </div>
          {(buyerSide || switching) && <p className="mt-1 text-2xs text-muted">Read from stored opportunities and signals: a request for a vendor, RFP or project counts as asking; a migration request or a recorded technology change counts as switching. Nothing is inferred beyond those records.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>
              {formatNumber(result.rows.length)} {result.rows.length === 1 ? "person" : "people"}
            </CardTitle>
            <p className="mt-0.5 text-2xs text-muted">{result.scope}</p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {result.rows.length === 0 ? (
            <EmptyState
              icon={UserSearch}
              title="Nobody matches"
              description="Widen the filters, or import a list — this searches what the workspace already holds, so a narrow result often means the data is not here yet rather than that nobody fits."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {result.rows.map((r) => (
                <li key={r.personId} className="flex items-start gap-2.5 px-4 py-2.5">
                  <Avatar name={r.name} src={r.avatarUrl ?? undefined} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-primary">{r.name}</span>
                      {r.isDecisionMaker ? (
                        <Tooltip content="Marked as a decision maker at this company.">
                          <span className="cursor-help">
                            <Badge variant="info" size="sm">
                              Decision maker
                            </Badge>
                          </span>
                        </Tooltip>
                      ) : null}
                      {r.lead ? (
                        <Link href={`/leads/${r.lead.id}`}>
                          <Badge variant="neutral" size="sm">
                            <span className={TIER[r.lead.tier as "A"]?.chip}>
                              Tier {r.lead.tier}
                            </span>
                          </Badge>
                        </Link>
                      ) : (
                        <Badge variant="neutral" size="sm">
                          Not a lead
                        </Badge>
                      )}
                      {r.contacts.optedOut ? (
                        <Tooltip content="This person opted out. No agent or sequence may contact them.">
                          <span className="cursor-help">
                            <Badge variant="danger" size="sm">
                              Opted out
                            </Badge>
                          </span>
                        </Tooltip>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-2xs text-secondary">
                      {r.title}
                      {r.company ? ` · ${r.company.name}` : ""}
                      {r.company.industry ? ` · ${r.company.industry}` : ""}
                      {r.company.city ? ` · ${r.company.city}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {r.contacts.revealed > 0 ? (
                      <Tooltip content={`${r.contacts.revealed} contact detail(s) already revealed.`}>
                        <span className="cursor-help text-2xs text-success-text">
                          <Unlock className="mr-0.5 inline size-2.5" />
                          {r.contacts.revealed}
                        </span>
                      </Tooltip>
                    ) : r.contacts.locked > 0 ? (
                      <Tooltip content={`${r.contacts.locked} locked. Revealing costs points.`}>
                        <span className="cursor-help text-2xs text-muted">
                          <Lock className="mr-0.5 inline size-2.5" />
                          {r.contacts.locked}
                        </span>
                      </Tooltip>
                    ) : (
                      <span className="text-2xs text-muted">no contacts</span>
                    )}
                    {r.company.intentScore > 0 ? (
                      <p className="text-2xs text-muted">intent {r.company.intentScore}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; count: number }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-2xs uppercase tracking-wider text-muted">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onToggle(o.value)}
          className={cn(
            "rounded-md px-1.5 py-0.5 text-2xs transition-colors duration-150",
            selected.has(o.value)
              ? "bg-accent-subtle font-medium text-accent-text"
              : "bg-surface-sunken text-muted hover:bg-surface-hover"
          )}
        >
          {o.value}
          <span className="ml-1 tabular text-muted">{o.count}</span>
        </button>
      ))}
    </div>
  );
}
