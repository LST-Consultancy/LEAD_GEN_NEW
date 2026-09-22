"use client";

import { useState } from "react";
import { Info, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { SignalNotice } from "@/components/intelligence/signal-notice";
import { cn } from "@/lib/utils";
import { formatInrCompact, formatNumber } from "@/lib/format";

type Bucket = {
  value: string;
  companies: number;
  signals: number;
  avgIntent: number;
  signalsPerCompany: number;
  openInr: number;
  wonInr: number;
};

export function MarketView({
  market,
  freshness,
}: {
  market: { windowDays: number; industries: Bucket[]; states: Bucket[]; caveat: string };
  freshness: { connected: boolean; notice: string };
}) {
  const [axis, setAxis] = useState<"industries" | "states">("industries");
  const rows = market[axis];
  const maxSignals = Math.max(1, ...rows.map((r) => r.signals));

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Market Intelligence</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Where movement is concentrated across the sectors and regions you sell into.
        </p>
      </div>

      <SignalNotice freshness={freshness} />

      <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-secondary">
        <Info className="mr-1 inline size-3" />
        {market.caveat}
      </div>

      <div className="flex items-center gap-1">
        {(
          [
            ["industries", "By industry"],
            ["states", "By region"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setAxis(k)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors duration-150",
              axis === k
                ? "bg-surface-active font-medium text-primary"
                : "text-secondary hover:bg-surface-hover"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={TrendingUp}
              title="Nothing to compare yet"
              description="This needs companies with an industry or region recorded. Import or enrich a few and the shape appears."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>
                {axis === "industries" ? "Industries" : "Regions"} ({rows.length})
              </CardTitle>
              <p className="mt-0.5 text-2xs text-muted">
                Signals over the last {market.windowDays} days. Sorted by activity, not size.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  Activity by {axis === "industries" ? "industry" : "region"}
                </caption>
                <thead className="bg-surface-sunken">
                  <tr className="border-y border-border">
                    {[
                      [axis === "industries" ? "Industry" : "Region", "left"],
                      ["Companies", "right"],
                      ["Signals", "right"],
                      ["Per company", "right"],
                      ["Avg intent", "right"],
                      ["Open", "right"],
                      ["Won", "right"],
                    ].map(([label, align], i) => (
                      <th
                        key={i}
                        scope="col"
                        className={cn(
                          "whitespace-nowrap px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted",
                          align === "right" ? "text-right" : "text-left"
                        )}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.value} className="border-b border-border-subtle last:border-0">
                      <td className="px-3 py-2">
                        <span className="text-primary">{r.value}</span>
                        <span
                          className="mt-1 block h-1 rounded-full bg-accent"
                          style={{ width: `${Math.max(4, (r.signals / maxSignals) * 100)}%` }}
                          aria-hidden
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular text-secondary">
                        {formatNumber(r.companies)}
                      </td>
                      <td className="px-3 py-2 text-right tabular font-medium text-primary">
                        {formatNumber(r.signals)}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-secondary">
                        <Tooltip content="Signals divided by companies — a sector with few companies but constant activity beats a big quiet one.">
                          <span className="cursor-help">{r.signalsPerCompany}</span>
                        </Tooltip>
                      </td>
                      <td className="px-3 py-2 text-right tabular text-secondary">
                        {r.avgIntent > 0 ? r.avgIntent : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-secondary">
                        {r.openInr > 0 ? formatInrCompact(r.openInr) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-success-text">
                        {r.wonInr > 0 ? formatInrCompact(r.wonInr) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
