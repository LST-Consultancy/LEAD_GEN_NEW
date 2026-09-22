import Link from "next/link";
import { AlertTriangle, Check, Info, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { formatAge, formatInr, formatNumber } from "@/lib/format";
import type { AiSettings } from "@/lib/services/ai-settings";

/** Why a tier exists, in the product's words rather than the enum's. */
const TIER_REASON: Record<string, string> = {
  fast: "Classification and extraction, where speed matters more than depth.",
  reasoning: "Research, strategy and anything a person will act on.",
  embedding: "Semantic search vectors. No adapter is built for this yet.",
};

/**
 * §89 — model routing, provider status and what it has cost.
 *
 * Read-only on purpose. The provider key is server environment configuration,
 * and a text field here that wrote it would be both a secret-handling hazard
 * and a lie about where the value lives.
 */
export function AiSettingsView({
  settings,
  tiers,
  exampleCostInr,
  exampleModel,
}: {
  settings: AiSettings;
  tiers: { tier: string; model: string }[];
  exampleCostInr: number;
  exampleModel: string;
}) {
  const { status, routes, usage, recentFailures } = settings;
  const wiredCount = routes.filter((r) => r.wired).length;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">AI Assistant</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Which model each feature uses, whether a provider is reachable, and what it has cost. AI
          explains your numbers here — it never produces a score. Scoring is deterministic and lives
          outside the model entirely.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-muted" />
            Provider
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-primary">{status.provider}</span>
            {status.configured ? (
              <Badge variant="success" size="sm">
                <Check className="size-2.5" />
                Key present
              </Badge>
            ) : (
              <Badge variant="warning" size="sm">
                <X className="size-2.5" />
                No key
              </Badge>
            )}
            {status.adaptersBuilt.includes(status.provider) ? null : (
              <Tooltip content="The routing table knows this provider, but no adapter is written for it in this build.">
                <span className="cursor-help">
                  <Badge variant="danger" size="sm">
                    Adapter not built
                  </Badge>
                </span>
              </Tooltip>
            )}
          </div>

          <p className="text-2xs leading-relaxed text-muted">
            Set from <span className="font-mono text-secondary">{status.source}</span>. The key
            itself is never read back into this screen — not even masked — so it can&apos;t be
            shoulder-read off a shared display. Adapters built in this version:{" "}
            {status.adaptersBuilt.join(", ")}.
          </p>

          {!status.configured ? (
            <div className="flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-2.5 text-2xs text-warning-text">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Without a key, every model-backed feature says it is unavailable rather than
                degrading quietly. Deterministic scoring, search and the routed Copilot answers
                carry on working.
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Feature routing</CardTitle>
          <span className="text-2xs text-muted">
            {wiredCount} of {routes.length} reach a model today
          </span>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="mb-3 text-2xs leading-relaxed text-muted">
            A feature is marked <em>wired</em> only where code actually calls the model. The rest are
            routed in config and would use the model shown the moment they are built — the table
            says which is which rather than implying all of them run.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-muted">
                  <th className="pb-1.5 font-semibold">Feature</th>
                  <th className="pb-1.5 font-semibold">Tier</th>
                  <th className="pb-1.5 font-semibold">Model</th>
                  <th className="pb-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.feature} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 font-mono text-2xs text-primary">{r.feature}</td>
                    <td className="py-1.5">
                      <Tooltip content={TIER_REASON[r.tier] ?? r.tier}>
                        <span className="cursor-help text-secondary">{r.tier}</span>
                      </Tooltip>
                    </td>
                    <td className="py-1.5 font-mono text-2xs text-secondary">
                      {r.model}
                      {r.priced ? null : (
                        <Tooltip content="No list price is recorded for this model, so its calls are logged with a cost of zero rather than a guess.">
                          <span className="ml-1 cursor-help text-muted">(unpriced)</span>
                        </Tooltip>
                      )}
                    </td>
                    <td className="py-1.5">
                      {r.wired ? (
                        <Badge variant="success" size="sm">
                          Wired
                        </Badge>
                      ) : (
                        <Badge variant="neutral" size="sm">
                          Routed, not built
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {tiers.map((t) => (
              <div key={t.tier} className="rounded-md border border-border bg-surface p-2.5">
                <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                  {t.tier}
                </p>
                <p className="mt-0.5 font-mono text-2xs text-primary">{t.model}</p>
                <p className="mt-1 text-2xs leading-relaxed text-muted">{TIER_REASON[t.tier]}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Spend, last {usage.days} days</CardTitle>
          <Tooltip content="Computed from published per-million-token list prices and the tokens each call actually used. This is not read from a billing API, so treat it as indicative.">
            <span className="cursor-help text-2xs text-muted">
              <Info className="mr-1 inline size-3" />
              Estimated, not billed
            </span>
          </Tooltip>
        </CardHeader>
        <CardContent className="pt-0">
          {usage.rows.length === 0 ? (
            <EmptyState
              compact
              title="Nothing has called a model yet"
              description="Ask the Copilot an open-ended question and the call, its tokens and its estimated cost will appear here."
              action={
                <Button asChild size="sm" variant="secondary">
                  <Link href="/copilot">Open Copilot</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-lg font-semibold tabular-nums text-primary">
                  ~{formatInr(usage.totalCostInr, { paise: true })}
                </span>
                <span className="text-2xs text-muted">
                  across {formatNumber(usage.totalCalls)}{" "}
                  {usage.totalCalls === 1 ? "call" : "calls"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-muted">
                      <th className="pb-1.5 font-semibold">Feature</th>
                      <th className="pb-1.5 text-right font-semibold">Calls</th>
                      <th className="pb-1.5 text-right font-semibold">Failed</th>
                      <th className="pb-1.5 text-right font-semibold">Tokens in</th>
                      <th className="pb-1.5 text-right font-semibold">Tokens out</th>
                      <th className="pb-1.5 text-right font-semibold">Avg latency</th>
                      <th className="pb-1.5 text-right font-semibold">Est. cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.rows.map((r) => (
                      <tr key={r.feature} className="border-b border-border/60 last:border-0">
                        <td className="py-1.5 font-mono text-2xs text-primary">{r.feature}</td>
                        <td className="py-1.5 text-right tabular-nums text-secondary">
                          {formatNumber(r.calls)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {r.failures > 0 ? (
                            <span className="text-danger-text">{formatNumber(r.failures)}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-secondary">
                          {formatNumber(r.inputTokens)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-secondary">
                          {formatNumber(r.outputTokens)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-secondary">
                          {r.avgLatencyMs === null ? (
                            <Tooltip content="No successful call to average. A failed call's latency measures the rejection, not the model.">
                              <span className="cursor-help text-muted">—</span>
                            </Tooltip>
                          ) : (
                            `${formatNumber(r.avgLatencyMs)}ms`
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-secondary">
                          {r.costInr > 0 ? `~${formatInr(r.costInr, { paise: true })}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-2xs leading-relaxed text-muted">
                A failed call is logged with zero cost, because nothing was generated. For scale: a
                typical grounded Copilot answer reads about 3,000 tokens of your data and writes
                about 250, which on{" "}
                <span className="font-mono text-secondary">{exampleModel}</span> is roughly{" "}
                <span className="tabular-nums">{formatInr(exampleCostInr, { paise: true })}</span>.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {recentFailures.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-muted" />
              Recent failures
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            {recentFailures.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs">
                <span className="font-mono text-primary">{f.feature}</span>
                <Badge variant="danger" size="sm">
                  {f.errorCode ?? "unknown"}
                </Badge>
                <span className="font-mono text-muted">{f.model}</span>
                <span className="tabular-nums text-muted">{formatNumber(f.latencyMs)}ms</span>
                <span className="text-muted">{formatAge(f.at)}</span>
              </div>
            ))}
            <p className="pt-1 text-2xs leading-relaxed text-muted">
              Every one of these returned a plain sentence to whoever asked, saying nothing was
              generated. None of them produced a partial or invented answer.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>What the model is not allowed to do</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 pt-0 text-2xs leading-relaxed text-secondary">
          <p>
            <strong className="text-primary">It never produces a score.</strong> Lead scoring is
            deterministic and inspectable, dimension by dimension. The model can explain a score; it
            cannot move one.
          </p>
          <p>
            <strong className="text-primary">It never answers without your data.</strong> The
            Copilot reads tools first and passes the results as context, with instructions
            forbidding new calculation, estimation or recall. A question it has no tool for gets
            told so.
          </p>
          <p>
            <strong className="text-primary">It never sends anything.</strong> Contacting a person
            is a separate, approval-gated action —{" "}
            <Link href="/approvals" className="text-brand-text underline-offset-2 hover:underline">
              Approvals
            </Link>{" "}
            shows what is waiting, and{" "}
            <Link
              href="/agent-activity"
              className="text-brand-text underline-offset-2 hover:underline"
            >
              Agent Activity
            </Link>{" "}
            shows everything that ran.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
