import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, formatPercent } from "@/lib/format";
import { LEAD_STATUS, OPPORTUNITY_TYPE_LABEL, TIER, type LeadStatusKey, type TierKey } from "@/lib/vocab";

type Stage = { key: string; label: string; count: number; shareOfCohort: number | null };

/** The same leads followed forward. Shares are of the cohort, and withheld when the cohort is empty. */
export function CohortFunnelCard({ days, stages }: { days: number; stages: Stage[] }) {
  const top = stages[0]?.count ?? 0;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>One cohort, followed forward</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">Leads surfaced in the last {days} days, and how many of those same leads went on to each step — unlike the funnel above, which counts each stage on its own.</p>
        </div>
      </CardHeader>
      <CardContent>
        {top === 0 ? <p className="text-xs text-secondary">No leads surfaced in this window, so there is no cohort to follow.</p> : (
          <ul className="space-y-1.5">
            {stages.map((s) => (
              <li key={s.key} className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-2 text-xs">
                <span className="min-w-0 truncate text-secondary">{s.label}</span>
                <span className="text-right tabular text-primary">{formatNumber(s.count)}</span>
                <span className="text-right tabular text-muted">{s.shareOfCohort === null ? "—" : formatPercent(s.shareOfCohort * 100)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const STATUSES: LeadStatusKey[] = ["NEW", "WORKING", "CONTACTED", "REPLIED", "QUALIFIED", "NURTURE", "UNQUALIFIED"];
const TIERS: TierKey[] = ["A", "B", "C", "D"];

/** Leads by tier and status. Each cell links to that exact slice on the Leads screen. */
export function LeadMixCard({ rows }: { rows: { tier: string; status: string; count: number }[] }) {
  const cell = (t: string, s: string) => rows.find((r) => r.tier === t && r.status === s)?.count ?? 0;
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Tier and status mix</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">{formatNumber(total)} active leads you can see. Click a number to open that slice.</p>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {total === 0 ? <p className="text-xs text-secondary">No leads yet.</p> : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-2xs uppercase tracking-wider text-muted">
                <th className="pb-1.5 text-left font-semibold">Tier</th>
                {STATUSES.map((s) => <th key={s} className="pb-1.5 text-right font-semibold">{LEAD_STATUS[s].label}</th>)}
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => (
                <tr key={t} className="border-t border-border-subtle">
                  <td className="py-1 font-medium text-primary">{TIER[t].label}</td>
                  {STATUSES.map((s) => {
                    const n = cell(t, s);
                    return <td key={s} className="py-1 text-right tabular">{n ? <Link className="text-primary hover:underline" href={`/leads?tiers=${t}&statuses=${s}`}>{formatNumber(n)}</Link> : <span className="text-muted">—</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/** Open opportunities by the kind of work they ask for, each linking to that list. */
export function DemandByTypeCard({ total, capped, types }: { total: number; capped: boolean; types: { type: string; opportunities: number; companies: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Active demand by kind of work</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">{formatNumber(total)}{capped ? "+" : ""} active opportunities in this workspace. One can ask for several kinds of work, so rows can add up to more than that.</p>
        </div>
      </CardHeader>
      <CardContent>
        {total === 0 ? <p className="text-xs text-secondary">No active opportunities yet. <Link href="/find-leads" className="text-brand-text hover:underline">Find opportunities</Link> to start.</p> : (
          <ul className="divide-y divide-border-subtle">
            {types.map((t) => (
              <li key={t.type} className="flex items-center gap-2 py-1.5 text-xs">
                <Link href={`/opportunities?type=${t.type}&status=ACTIVE`} className="min-w-0 flex-1 truncate text-primary hover:underline">{OPPORTUNITY_TYPE_LABEL[t.type] ?? t.type}</Link>
                <span className="tabular text-primary">{formatNumber(t.opportunities)}</span>
                <span className="w-24 text-right text-2xs text-muted tabular">{formatNumber(t.companies)} {t.companies === 1 ? "company" : "companies"}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
