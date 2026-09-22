"use client";

import * as React from "react";
import { AlertTriangle, Check, CircleHelp, Minus, Sparkles, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { DealTemperature } from "@/components/domain/indicators";
import { FitRadar, type RadarDimension } from "@/components/leads/dossier/fit-radar";
import { formatAge, formatInrCompact } from "@/lib/format";
import type { IntentKey } from "@/lib/vocab";
import { cn } from "@/lib/utils";

type ReadinessItem = { code: string; label: string; state: string; evidence: string | null };

/**
 * §22 — a verdict is allowed only because every clause below it is derived from
 * a stored dimension or a stored signal. The headline is computed from the same
 * numbers shown underneath, so it can't drift from them.
 */
export function AiVerdict({
  score,
  tier,
  intent,
  dimensions,
  readiness,
  signalCount,
  latestSignalAt,
  estimatedBudgetInr,
  surfacedReason,
  hasReplied,
  isDecisionMaker,
}: {
  score: number;
  tier: string;
  intent: string;
  dimensions: RadarDimension[];
  readiness: ReadinessItem[];
  signalCount: number;
  latestSignalAt: string | null;
  estimatedBudgetInr: number | null;
  surfacedReason: string;
  hasReplied: boolean;
  isDecisionMaker: boolean;
}) {
  const byKey = Object.fromEntries(dimensions.map((d) => [d.key, d.value]));

  const headline =
    score >= 8
      ? "Strong opportunity"
      : score >= 6.5
        ? "Worth pursuing"
        : score >= 4.5
          ? "Keep warm"
          : "Low priority for now";

  const tone =
    score >= 8
      ? "border-success-border bg-success-subtle text-success-text"
      : score >= 6.5
        ? "border-brand-border bg-brand-subtle text-brand-text"
        : score >= 4.5
          ? "border-warning-border bg-warning-subtle text-warning-text"
          : "border-border bg-surface-sunken text-secondary";

  // Each of these is a sentence assembled from a specific stored number.
  const whyFit = buildWhyFit(byKey, isDecisionMaker);
  const whyNow = buildWhyNow(byKey, latestSignalAt, signalCount);
  const risks = buildRisks(byKey, readiness, hasReplied, estimatedBudgetInr);
  const angle = buildAngle(byKey, surfacedReason);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-ai-accent" />
            AI verdict
          </CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            Derived from the eight stored dimensions — not a separate opinion
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className={cn("rounded-lg border px-3 py-2.5", tone)}>
          <p className="text-sm font-semibold">{headline}</p>
          <p className="mt-0.5 text-xs leading-relaxed opacity-90">
            Tier {tier} · {score}/10 · intent {intent.toLowerCase()}
            {estimatedBudgetInr ? ` · est. ${formatInrCompact(estimatedBudgetInr)}` : ""}
          </p>
        </div>

        <VerdictSection title="Why they surfaced" body={surfacedReason} />
        <VerdictSection title="Why they fit" body={whyFit} />
        <VerdictSection title="Why now" body={whyNow} />
        <VerdictSection title="Risk factors" body={risks} tone="warning" />
        <VerdictSection title="Suggested angle" body={angle} tone="brand" />

        <div className="border-t border-border-subtle pt-3">
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">
            Deal temperature
          </p>
          <DealTemperature intent={intent as IntentKey} />
        </div>
      </CardContent>
    </Card>
  );
}

function VerdictSection({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone?: "warning" | "brand";
}) {
  return (
    <div>
      <p
        className={cn(
          "text-2xs font-semibold uppercase tracking-wider",
          tone === "warning" ? "text-warning-text" : tone === "brand" ? "text-brand-text" : "text-muted"
        )}
      >
        {title}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-secondary">{body}</p>
    </div>
  );
}

function buildWhyFit(d: Record<string, number>, isDecisionMaker: boolean): string {
  const parts: string[] = [];
  if (d.fit >= 70) parts.push("They match your ICP closely on industry, size and location");
  else if (d.fit >= 40) parts.push("Partial ICP match — some dimensions line up, others don't");
  else parts.push("Weak ICP match on the criteria you defined");

  if (isDecisionMaker) parts.push("and this person can authorise the purchase");
  else if (d.authority >= 50) parts.push("and this person has meaningful influence");
  else parts.push("but this person is unlikely to be the decision maker");

  return `${parts.join(" ")}.`;
}

function buildWhyNow(
  d: Record<string, number>,
  latestSignalAt: string | null,
  signalCount: number
): string {
  if (signalCount === 0) {
    return "Nothing indicates this is a live project. They matched your ICP on attributes, not behaviour — so there is no timing argument for contacting them today.";
  }
  const freshness = latestSignalAt ? formatAge(latestSignalAt) : "recently";
  if (d.urgency >= 60) {
    return `A time-boxed project is visible in the evidence, most recently ${freshness}. Urgency scores ${d.urgency}/100, which is the strongest class of timing signal the system detects.`;
  }
  if (d.urgency >= 30) {
    return `There is a real need in the evidence but no stated deadline. Most recent signal was ${freshness}. Worth qualifying urgency before investing heavily.`;
  }
  return `${signalCount} signal${signalCount === 1 ? "" : "s"} on record, most recent ${freshness}, but none names a timeline. Treat as interest rather than an active project.`;
}

function buildRisks(
  d: Record<string, number>,
  readiness: ReadinessItem[],
  hasReplied: boolean,
  budget: number | null
): string {
  const risks: string[] = [];
  if (!budget && d.budget < 40) risks.push("no budget has been confirmed");
  if (d.authority < 45) risks.push("the decision maker has not been identified");
  if (d.reachability < 30) risks.push("there is no reliable way to contact them yet");
  if (!hasReplied && d.engagement === 0) risks.push("they have never responded to you");
  if (d.recency < 30) risks.push("the evidence is going stale");
  const unresolved = readiness.filter((r) => r.state === "no").length;
  if (unresolved >= 3) risks.push(`${unresolved} readiness checks are failing`);

  if (risks.length === 0) {
    return "Nothing material is missing. Budget, authority, need and reachability are all evidenced.";
  }
  return `${risks[0].charAt(0).toUpperCase()}${risks[0].slice(1)}${
    risks.length > 1 ? `; ${risks.slice(1).join("; ")}` : ""
  }.`;
}

function buildAngle(d: Record<string, number>, surfacedReason: string): string {
  if (d.urgency >= 60) {
    return `Lead with their deadline, not your capability. The signal already told you what they need — reference it directly and make the first reply short enough to answer on a phone.`;
  }
  if (d.intent >= 50) {
    return `Open with the specific problem named in their signal: "${surfacedReason.slice(0, 90)}${surfacedReason.length > 90 ? "…" : ""}". A comparable case study will outperform a feature list.`;
  }
  if (d.fit >= 60) {
    return "Good fit but no demonstrated intent. Add them to Radar and wait for a behavioural signal rather than spending credibility on a cold approach now.";
  }
  return "Not enough evidence to justify outreach. Leave them in the database and let the radar surface them if something changes.";
}

const READINESS_ICON: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; tone: string; label: string }
> = {
  yes: { icon: Check, tone: "text-success", label: "Confirmed" },
  unknown: { icon: CircleHelp, tone: "text-warning", label: "Unclear" },
  no: { icon: X, tone: "text-danger", label: "Missing" },
  na: { icon: Minus, tone: "text-muted", label: "Not applicable" },
};

/** §25 — the readiness checklist, with the evidence for each line. */
export function ReadinessChecklist({ items }: { items: ReadinessItem[] }) {
  const confirmed = items.filter((i) => i.state === "yes").length;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Deal readiness</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            {confirmed} of {items.length} confirmed · updated as evidence arrives
          </p>
        </div>
        <Badge
          variant={confirmed >= items.length - 1 ? "success" : confirmed >= 3 ? "warning" : "neutral"}
          size="lg"
        >
          {confirmed}/{items.length}
        </Badge>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {items.map((item) => {
            const meta = READINESS_ICON[item.state] ?? READINESS_ICON.unknown;
            const Icon = meta.icon;
            return (
              <li key={item.code} className="flex gap-2">
                <Tooltip content={meta.label}>
                  <Icon className={cn("mt-0.5 size-3.5 shrink-0", meta.tone)} />
                </Tooltip>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-xs font-medium",
                      item.state === "yes" ? "text-primary" : "text-secondary"
                    )}
                  >
                    {item.label}
                  </p>
                  {item.evidence ? (
                    <p className="text-2xs leading-relaxed text-muted">{item.evidence}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** §24 — the radar, plus a drill-down into whichever axis is selected. */
export function FitRadarPanel({ dimensions }: { dimensions: RadarDimension[] }) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const axis = dimensions.find((d) => d.key === selected);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Fit radar</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">Six dimensions, each inspectable</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <FitRadar dimensions={dimensions} selected={selected} onSelect={setSelected} />

        {axis ? (
          <div className="rounded-md border border-border-subtle bg-surface-sunken p-3 animate-in-up">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-primary">{axis.label}</p>
              <span className="text-xs font-semibold text-brand-text tabular">{axis.value}/100</span>
            </div>
            <p className="mt-0.5 text-2xs text-muted">{axis.question}</p>

            {axis.evidence.length === 0 ? (
              <p className="mt-2 text-2xs text-muted">
                No evidence recorded for this dimension — that is why it scores where it does.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
                {axis.evidence.map((e, i) => (
                  <li key={i} className="flex gap-2 text-2xs">
                    <span
                      className={cn(
                        "shrink-0 font-mono font-semibold tabular",
                        e.points > 0
                          ? "text-success-text"
                          : e.points < 0
                            ? "text-danger-text"
                            : "text-muted"
                      )}
                    >
                      {e.points > 0 ? `+${e.points}` : e.points === 0 ? "0" : e.points}
                    </span>
                    <span className="min-w-0">
                      <span className="block leading-relaxed text-secondary">{e.label}</span>
                      {e.detail ? (
                        <span className="block leading-relaxed text-muted">{e.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="flex items-start gap-1.5 rounded-md bg-surface-sunken px-2.5 py-2 text-2xs leading-relaxed text-muted">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            Every axis is a stored number with stored evidence. Nothing on this chart is inferred at
            render time.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
