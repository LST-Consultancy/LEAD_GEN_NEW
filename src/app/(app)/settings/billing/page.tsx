import type { Metadata } from "next";
import { AlertTriangle, Check, CreditCard, Zap } from "lucide-react";
import { requireAuth } from "@/lib/auth/context";
import { getBillingSettings } from "@/lib/services/settings";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Metric } from "@/components/charts/metric";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDate, formatDateTime, formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing & Points" };

const TXN_LABEL: Record<string, string> = {
  PURCHASE: "Top-up purchase",
  PLAN_ALLOCATION: "Plan allocation",
  REVEAL: "Contact reveal",
  RESEARCH: "Deep research",
  ENRICHMENT: "Enrichment",
  VOICE_NOTE: "Voice note",
  REFUND: "Refund",
  ADMIN_ADJUSTMENT: "Admin adjustment",
  EXPIRY: "Expiry",
};

export default async function BillingPage() {
  const ctx = await requireAuth();
  const { subscription, ledger, projection, todaySpend, spendByType, plans } =
    await getBillingSettings(ctx);

  const allowance = subscription?.plan.pointsMonthly ?? 0;
  const pct = allowance > 0 ? Math.min(100, (projection.balance / allowance) * 100) : 0;
  const low = pct < 15;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-primary">Billing &amp; points</h1>
        <p className="mt-0.5 text-xs text-secondary">
          The ledger below is append-only. Rows are never edited or deleted, so the balance is
          always reconstructible from history.
        </p>
      </header>

      {/* Balance and burn rate */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <Zap className="size-3.5" />
              Point balance
            </CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              1 point reveals a verified contact · 2 points run a deep research report
            </p>
          </div>
          {low ? (
            <Badge variant="warning" uppercase>
              <AlertTriangle />
              Running low
            </Badge>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-3">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-3xl font-semibold tracking-tight text-primary tabular">
                {formatNumber(projection.balance)}
              </span>
              <span className="text-xs text-muted tabular">
                of {formatNumber(Math.max(allowance, projection.balance))} this cycle
              </span>
            </div>
            <Progress
              value={pct}
              className="mt-2"
              label={`${projection.balance} points remaining`}
              barClassName={low ? "bg-warning" : undefined}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Metric label="Spent today" value={String(todaySpend)} sub="points" />
            <Metric
              label="Last 14 days"
              value={String(projection.spentLast14Days)}
              sub="points"
            />
            <Metric
              label="Daily average"
              value={String(projection.averagePerDay)}
              sub="points/day"
            />
            <Metric
              label="Runway"
              value={projection.daysRemaining !== null ? `${projection.daysRemaining}d` : "—"}
              sub="at current rate"
              tone={
                projection.daysRemaining !== null && projection.daysRemaining < 7
                  ? "serious"
                  : projection.daysRemaining !== null && projection.daysRemaining < 14
                    ? "warning"
                    : "good"
              }
              hint="Straight-line projection from the last 14 days of spend. Not a forecast of future usage."
            />
          </div>

          {projection.daysRemaining !== null ? (
            <p className="rounded-md bg-surface-sunken px-2.5 py-2 text-2xs leading-relaxed text-secondary">
              At {projection.averagePerDay} points a day, your balance lasts roughly{" "}
              <strong>{projection.daysRemaining} days</strong>. That is arithmetic on your own
              14-day history, not a prediction.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Where points go */}
      {spendByType.length > 0 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Where your points went</CardTitle>
              <p className="mt-0.5 text-2xs text-muted">Last 30 days</p>
            </div>
          </CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <caption className="sr-only">Point spend by transaction type over 30 days</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted">
                    Type
                  </th>
                  <th scope="col" className="py-1.5 text-right text-2xs font-semibold uppercase tracking-wider text-muted">
                    Operations
                  </th>
                  <th scope="col" className="py-1.5 text-right text-2xs font-semibold uppercase tracking-wider text-muted">
                    Points
                  </th>
                </tr>
              </thead>
              <tbody>
                {spendByType
                  .slice()
                  .sort((a, b) => b.points - a.points)
                  .map((s) => (
                    <tr key={s.type} className="border-b border-border-subtle last:border-0">
                      <th scope="row" className="py-1.5 text-left font-medium text-secondary">
                        {TXN_LABEL[s.type] ?? s.type}
                      </th>
                      <td className="py-1.5 text-right text-secondary tabular">{s.count}</td>
                      <td className="py-1.5 text-right font-semibold text-primary tabular">
                        {s.points}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {/* Plan */}
      {subscription ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5">
                <CreditCard className="size-3.5" />
                Plan
              </CardTitle>
              <p className="mt-0.5 text-2xs text-muted">
                {subscription.status === "trialing" && subscription.trialEndsAt
                  ? `Trial ends ${formatDate(subscription.trialEndsAt)}`
                  : `Renews ${formatDate(subscription.currentPeriodEnd)}`}
              </p>
            </div>
            <Badge variant={subscription.status === "active" ? "success" : "warning"} uppercase>
              {subscription.status}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-3">
              {plans.map((p) => (
                <div
                  key={p.key}
                  className={cn(
                    "rounded-lg border p-3",
                    p.isCurrent ? "border-brand bg-brand-subtle" : "border-border bg-surface"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        p.isCurrent ? "text-brand-text" : "text-primary"
                      )}
                    >
                      {p.name}
                    </span>
                    {p.isCurrent ? (
                      <Badge variant="solid" size="sm" uppercase>
                        Current
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-lg font-semibold text-primary tabular">
                    {formatInr(p.priceMonthly)}
                    <span className="text-2xs font-normal text-muted">/mo</span>
                  </p>
                  <p className="mt-0.5 text-2xs leading-relaxed text-secondary">{p.description}</p>
                  <ul className="mt-2 space-y-0.5 border-t border-border-subtle pt-2">
                    <PlanLine label={`${formatNumber(p.pointsMonthly)} points a month`} />
                    <PlanLine
                      label={`${p.seatsIncluded} ${p.seatsIncluded === 1 ? "seat" : "seats"}`}
                    />
                    {(p.features as Record<string, unknown>)?.autopilot ? (
                      <PlanLine label="Autopilot" />
                    ) : null}
                    {(p.features as Record<string, unknown>)?.mcp ? (
                      <PlanLine label="MCP + API access" />
                    ) : null}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter>
            <p className="text-2xs text-muted">
              Plans are database rows, not hardcoded prices. Payment collection, GST invoicing and
              plan changes land in Phase 10.
            </p>
          </CardFooter>
        </Card>
      ) : null}

      {/* Ledger */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Transaction ledger</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              Most recent {ledger.length} entries · immutable, append-only
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-0">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Point transaction ledger</caption>
              <thead className="sticky top-0 bg-surface-sunken">
                <tr className="border-y border-border">
                  <th scope="col" className="px-3 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted">
                    When
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted">
                    Reason
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right text-2xs font-semibold uppercase tracking-wider text-muted">
                    Change
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right text-2xs font-semibold uppercase tracking-wider text-muted">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-b border-border-subtle last:border-0">
                    <td className="whitespace-nowrap px-3 py-1.5 text-2xs text-muted">
                      {formatDateTime(l.createdAt, ctx.workspace.timezone)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className="text-2xs text-secondary">
                        {TXN_LABEL[l.type] ?? l.type}
                      </span>
                      {l.actorType !== "HUMAN" ? (
                        <Tooltip content={`Recorded by ${l.actorType.toLowerCase()}`}>
                          <Badge size="sm" variant="ai" className="ml-1">
                            {l.actorType}
                          </Badge>
                        </Tooltip>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-2xs text-secondary">{l.reason}</td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-1.5 text-right font-mono text-2xs font-semibold tabular",
                        l.delta > 0 ? "text-success-text" : "text-danger-text"
                      )}
                    >
                      {l.delta > 0 ? `+${l.delta}` : l.delta}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-2xs text-primary tabular">
                      {formatNumber(l.balanceAfter)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlanLine({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-2xs text-secondary">
      <Check className="size-3 shrink-0 text-success" />
      {label}
    </li>
  );
}
