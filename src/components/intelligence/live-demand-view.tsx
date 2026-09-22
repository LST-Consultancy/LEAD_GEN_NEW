"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Info, Radio, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { SignalNotice } from "@/components/intelligence/signal-notice";
import { formatAge, formatNumber } from "@/lib/format";
import { TIER } from "@/lib/vocab";

type Demand = {
  windowDays: number;
  total: number;
  uncategorised: number;
  uncategorisedTypes: string[];
  categories: {
    key: string;
    label: string;
    meaning: string;
    count: number;
    companies: number;
    topIntent: number;
    signals: {
      id: string;
      typeLabel: string;
      title: string;
      excerpt: string;
      source: string;
      sourceUrl: string | null;
      confidence: number;
      intentDelta: number;
      at: string;
      suggestedAction: string | null;
      company: { id: string; name: string; industry: string | null; city: string | null } | null;
      lead: { id: string; tier: string; intent: string; name: string } | null;
    }[];
  }[];
};

export function LiveDemandView({
  demand,
  freshness,
}: {
  demand: Demand;
  freshness: { connected: boolean; notice: string };
}) {
  const [open, setOpen] = useState<string | null>(demand.categories[0]?.key ?? null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Live Demand</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Buyer signals grouped by what they mean rather than where they came from — because
          &ldquo;hiring for the role&rdquo; and &ldquo;published a tender&rdquo; call for
          different responses even when both arrived from the same place.
        </p>
      </div>

      <SignalNotice freshness={freshness} />

      {demand.categories.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Radio}
              title="No demand signals in this window"
              description="Signals arrive from discovery sources. None is connected, so this fills up only from what is already recorded or imported."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat
              label="Signals"
              value={formatNumber(demand.total)}
              hint={`last ${demand.windowDays} days`}
            />
            <Stat
              label="Categories with activity"
              value={formatNumber(demand.categories.length)}
              hint="empty ones are hidden"
            />
            <Stat
              label="Companies"
              value={formatNumber(
                new Set(
                  demand.categories.flatMap((c) => c.signals.map((s) => s.company?.id))
                ).size
              )}
              hint="across the shown signals"
            />
          </div>

          <div className="flex flex-col gap-2">
            {demand.categories.map((c) => (
              <Card key={c.key}>
                <CardHeader className="flex-row items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setOpen(open === c.key ? null : c.key)}
                    className="min-w-0 text-left"
                    aria-expanded={open === c.key}
                  >
                    <CardTitle>{c.label}</CardTitle>
                    <p className="mt-0.5 text-2xs text-muted">{c.meaning}</p>
                  </button>
                  <div className="flex shrink-0 items-center gap-3 text-right">
                    <div>
                      <p className="text-2xs text-muted">Signals</p>
                      <p className="text-sm font-semibold tabular text-primary">{c.count}</p>
                    </div>
                    <Tooltip content="Distinct companies. Five posts from one company is one opportunity, not five.">
                      <div className="cursor-help">
                        <p className="text-2xs text-muted">Companies</p>
                        <p className="text-sm font-semibold tabular text-primary">{c.companies}</p>
                      </div>
                    </Tooltip>
                  </div>
                </CardHeader>

                {open === c.key ? (
                  <CardContent className="p-0">
                    <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                      {c.signals.map((s) => (
                        <li key={s.id} className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium text-primary">{s.title}</span>
                            <Badge variant="neutral" size="sm">
                              {s.typeLabel}
                            </Badge>
                            {s.intentDelta > 0 ? (
                              <Tooltip content="How much this signal moved the lead's intent score.">
                                <span className="cursor-help text-2xs text-success-text">
                                  +{s.intentDelta} intent
                                </span>
                              </Tooltip>
                            ) : null}
                            <Tooltip content="How confident the source is that this is what it appears to be.">
                              <span className="cursor-help text-2xs text-muted">
                                {s.confidence}% confidence
                              </span>
                            </Tooltip>
                          </div>
                          <p className="mt-0.5 text-2xs text-secondary">{s.excerpt}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
                            {s.company ? (
                              <span>
                                {s.company.name}
                                {s.company.city ? ` · ${s.company.city}` : ""}
                              </span>
                            ) : null}
                            <span>· {s.source}</span>
                            <span>· {formatAge(s.at)}</span>
                            {s.lead ? (
                              <Link
                                href={`/leads/${s.lead.id}`}
                                className="text-accent-text hover:underline"
                              >
                                · {s.lead.name}{" "}
                                <span className={TIER[s.lead.tier as "A"]?.chip}>
                                  {s.lead.tier}
                                </span>
                              </Link>
                            ) : null}
                            {s.sourceUrl ? (
                              <a
                                href={s.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent-text hover:underline"
                              >
                                · source <ExternalLink className="inline size-2.5" />
                              </a>
                            ) : null}
                          </p>
                          {s.suggestedAction ? (
                            <p className="mt-1 text-2xs text-secondary">
                              <Sparkles className="mr-0.5 inline size-2.5 text-muted" />
                              {s.suggestedAction}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {c.count > c.signals.length ? (
                      <p className="px-4 py-2 text-2xs text-muted">
                        and {c.count - c.signals.length} more in this category
                      </p>
                    ) : null}
                  </CardContent>
                ) : null}
              </Card>
            ))}
          </div>

          {demand.uncategorised > 0 ? (
            <p className="text-2xs text-muted">
              <Info className="mr-0.5 inline size-2.5" />
              {demand.uncategorised} signal{demand.uncategorised === 1 ? "" : "s"} of type{" "}
              {demand.uncategorisedTypes.join(", ")} did not fit a category and are counted in the
              total but not shown above.
            </p>
          ) : null}
        </>
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
