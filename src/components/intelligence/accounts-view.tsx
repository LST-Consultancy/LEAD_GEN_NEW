"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { formatAge, formatInrCompact, formatNumber } from "@/lib/format";
import { TIER } from "@/lib/vocab";

type Account = {
  opportunities: { id: string; title: string; intentScore: number; status: string }[];
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  employeeCount: number | null;
  technologies: string[];
  intentScore: number;
  lastSignalAt: string | null;
  signalCount: number;
  conversationCount: number;
  recentSignals: { title: string; type: string; at: string }[];
  leads: { id: string; name: string; tier: string; intent: string; status: string }[];
  openDeals: { id: string; title: string; valueInr: number; stage: string }[];
  openValueInr: number;
  wonValueInr: number;
  committee: {
    personId: string;
    name: string;
    role: string;
    influence: number;
    sentiment: string | null;
    confirmed: boolean;
  }[];
  committeeHealth: {
    mapped: number;
    confirmed: number;
    hasDecisionMaker: boolean;
    blockers: number;
    singleThreaded: boolean;
  };
};

const ROLE_LABEL: Record<string, string> = {
  CHAMPION: "champion",
  DECISION_MAKER: "decision maker",
  INFLUENCER: "influencer",
  TECHNICAL_EVALUATOR: "technical",
  FINANCE: "finance",
  PROCUREMENT: "procurement",
  BLOCKER: "blocker",
  UNKNOWN: "unknown",
};

type PlanSection = { key: string; title: string; body: string };
type PlanState =
  | { accountId: string; status: "loading" }
  | { accountId: string; status: "error"; reason: string }
  | { accountId: string; status: "done"; sections: PlanSection[] };

export function AccountsView({ accounts }: { accounts: Account[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState<PlanState | null>(null);

  async function generatePlan(accountId: string) {
    setPlan({ accountId, status: "loading" });
    try {
      const res = await fetch(`/api/accounts/${accountId}/plan`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setPlan({
          accountId,
          status: "error",
          reason: body.error?.message ?? "Couldn't generate a plan.",
        });
        return;
      }
      setPlan({ accountId, status: "done", sections: body.sections });
    } catch {
      setPlan({ accountId, status: "error", reason: "Couldn't reach the server." });
    }
  }

  const filtered = q
    ? accounts.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()))
    : accounts;

  const atRisk = accounts.filter((a) => a.committeeHealth.singleThreaded);
  const totalOpen = accounts.reduce((n, a) => n + a.openValueInr, 0);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Accounts</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Company-level intelligence, including who is actually involved in the decision. A
          committee of one is the most common reason a deal dies quietly, so it is called out
          rather than counted.
        </p>
      </div>

      {atRisk.length > 0 ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>
            {atRisk.length === 1
              ? "One account with an open deal is single-threaded"
              : `${atRisk.length} accounts with open deals are single-threaded`}
          </strong>{" "}
          — one known contact carrying the whole relationship:{" "}
          {atRisk.slice(0, 4).map((a) => a.name).join(", ")}
          {atRisk.length > 4 ? ` and ${atRisk.length - 4} more` : ""}.
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Accounts" value={formatNumber(accounts.length)} hint="with data here" />
        <Stat label="Open value" value={formatInrCompact(totalOpen)} hint="across all accounts" />
        <Stat
          label="Committees mapped"
          value={formatNumber(accounts.filter((a) => a.committeeHealth.mapped > 1).length)}
          hint="more than one contact"
        />
        <Stat
          label="Single-threaded"
          value={formatNumber(atRisk.length)}
          hint="with an open deal"
        />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter accounts"
          className="pl-8 text-xs"
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Building2}
              title={accounts.length === 0 ? "No accounts yet" : "Nothing matches"}
              description="An account appears here once a lead, a signal or a deal attaches to a company."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((a) => (
            <Card key={a.id}>
              <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(expanded === a.id ? null : a.id);
                    setPlan(null);
                  }}
                  className="flex min-w-0 items-start gap-2 text-left"
                  aria-expanded={expanded === a.id}
                >
                  {expanded === a.id ? (
                    <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted" />
                  ) : (
                    <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted" />
                  )}
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate">{a.name}</span>
                      {a.committeeHealth.singleThreaded ? (
                        <Tooltip content="One known contact and an open deal. If they go quiet or leave, the deal goes with them.">
                          <span className="cursor-help">
                            <Badge variant="warning" size="sm">
                              Single-threaded
                            </Badge>
                          </span>
                        </Tooltip>
                      ) : null}
                      {a.committeeHealth.blockers > 0 ? (
                        <Badge variant="danger" size="sm">
                          {a.committeeHealth.blockers} blocker
                          {a.committeeHealth.blockers > 1 ? "s" : ""}
                        </Badge>
                      ) : null}
                    </CardTitle>
                    <p className="mt-0.5 truncate text-2xs text-muted">
                      {[
                        a.industry,
                        a.city,
                        a.employeeCount ? `${formatNumber(a.employeeCount)} staff` : null,
                        a.signalCount > 0 ? `${a.signalCount} signals` : null,
                        a.lastSignalAt ? `last ${formatAge(a.lastSignalAt)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-3 text-right">
                  {a.intentScore > 0 ? (
                    <div>
                      <p className="text-2xs text-muted">Intent</p>
                      <p className="text-sm font-semibold tabular text-primary">{a.intentScore}</p>
                    </div>
                  ) : null}
                  {a.openValueInr > 0 ? (
                    <div>
                      <p className="text-2xs text-muted">Open</p>
                      <p className="text-sm font-semibold tabular text-primary">
                        {formatInrCompact(a.openValueInr)}
                      </p>
                    </div>
                  ) : null}
                </div>
              </CardHeader>

              {expanded === a.id ? (
                <CardContent className="flex flex-col gap-3 pt-0">
                  <div>
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
                      <Users className="mr-0.5 inline size-2.5" />
                      Buying committee ({a.committeeHealth.mapped} mapped,{" "}
                      {a.committeeHealth.confirmed} confirmed)
                    </p>
                    {a.committee.length === 0 ? (
                      <p className="text-2xs text-muted">
                        Nobody mapped. Every contact at this company is an unknown quantity in the
                        decision.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {a.committee.map((m) => (
                          <Tooltip
                            key={m.personId}
                            content={
                              m.confirmed
                                ? `Confirmed ${ROLE_LABEL[m.role]}, influence ${m.influence}`
                                : `Inferred ${ROLE_LABEL[m.role]} — treat the role as a guess`
                            }
                          >
                            <span
                              className={cn(
                                "cursor-help rounded-md px-2 py-1 text-2xs",
                                m.role === "BLOCKER"
                                  ? "bg-danger-subtle text-danger-text"
                                  : m.confirmed
                                    ? "bg-success-subtle text-success-text"
                                    : "bg-surface-sunken text-secondary"
                              )}
                            >
                              {m.name}
                              <span className="ml-1 text-muted">{ROLE_LABEL[m.role]}</span>
                              {!m.confirmed ? <span className="ml-0.5 text-muted">?</span> : null}
                            </span>
                          </Tooltip>
                        ))}
                      </div>
                    )}
                    {!a.committeeHealth.hasDecisionMaker && a.committee.length > 0 ? (
                      <p className="mt-1 text-2xs text-warning-text">
                        <Info className="mr-0.5 inline size-2.5" />
                        No decision maker or champion identified — nobody here is known to be able
                        to say yes.
                      </p>
                    ) : null}
                  </div>

                  {a.leads.length > 0 ? (
                    <div>
                      <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
                        Leads
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {a.leads.map((l) => (
                          <Link
                            key={l.id}
                            href={`/leads/${l.id}`}
                            className="rounded-md bg-surface-sunken px-2 py-1 text-2xs text-secondary hover:bg-surface-hover"
                          >
                            {l.name}
                            <span className={cn("ml-1", TIER[l.tier as "A"]?.chip)}>{l.tier}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {a.openDeals.length > 0 ? (
                    <div>
                      <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
                        Open deals
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {a.openDeals.map((d) => (
                          <li key={d.id} className="text-2xs text-secondary">
                            {d.title} · <span className="tabular">{formatInrCompact(d.valueInr)}</span>{" "}
                            · {d.stage}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="space-y-2"><h3 className="text-sm font-semibold">Opportunities</h3>{a.opportunities.length ? a.opportunities.map(o => <Link key={o.id} href={`/opportunities/${o.id}`} className="block text-xs underline">{o.intentScore} · {o.title} · {o.status}</Link>) : <p className="text-xs text-secondary">No discovered opportunities.</p>}</div>
                  {a.recentSignals.length > 0 ? (
                    <div>
                      <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">
                        Recent signals
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {a.recentSignals.map((s, i) => (
                          <li key={i} className="text-2xs text-secondary">
                            {s.title} <span className="text-muted">· {formatAge(s.at)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {a.technologies.length > 0 ? (
                    <p className="text-2xs text-muted">Runs: {a.technologies.join(", ")}</p>
                  ) : null}

                  <div className="border-t border-border-subtle pt-2.5">
                    {plan?.accountId !== a.id ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => generatePlan(a.id)}
                        disabled={a.committee.length === 0 && a.openDeals.length === 0}
                      >
                        <Sparkles />
                        Generate account plan
                      </Button>
                    ) : plan.status === "loading" ? (
                      <p className="flex items-center gap-1.5 text-2xs text-muted">
                        <Loader2 className="size-3 animate-spin" />
                        Writing a plan from this account&apos;s committee, deals and signals…
                      </p>
                    ) : plan.status === "error" ? (
                      <div className="flex flex-col items-start gap-1.5">
                        <p className="text-2xs text-danger-text">{plan.reason}</p>
                        <Button variant="secondary" size="sm" onClick={() => generatePlan(a.id)}>
                          <Sparkles />
                          Try again
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
                          <Sparkles className="size-3 text-ai-accent" />
                          Account plan
                        </p>
                        {plan.sections.map((s) => (
                          <div key={s.key}>
                            <p className="text-xs font-semibold text-primary">{s.title}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-secondary">{s.body}</p>
                          </div>
                        ))}
                        <Button variant="ghost" size="sm" onClick={() => generatePlan(a.id)}>
                          Regenerate
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              ) : null}
            </Card>
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
