"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip } from "@/components/ui/tooltip";
import { ScoreDial } from "@/components/domain/indicators";
import { ScoreOverrideDialog } from "@/components/leads/dossier/lead-actions";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Dimension = {
  key: string;
  label: string;
  question: string;
  value: number;
  evidence: { points: number; label: string; detail: string | null; sourceType: string }[];
};

/**
 * §72 — "Why 9/10?" answered in full. Every dimension, its value, and the
 * individual evidence rows that produced it, with the weighting shown. A user
 * can disagree and override, and the override is stored as feedback (§73).
 */
export function ScoreExplainer({
  leadId,
  displayScore,
  rawScore,
  composite,
  isOverridden,
  overrideReason,
  computedAt,
  modelVersion,
  dimensions,
}: {
  leadId: string;
  displayScore: number;
  rawScore: number;
  composite: number;
  isOverridden: boolean;
  overrideReason: string | null;
  computedAt: string;
  modelVersion: string;
  dimensions: Dimension[];
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(
    new Set(dimensions.filter((d) => d.evidence.length > 0).slice(0, 2).map((d) => d.key))
  );

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allEvidence = dimensions.flatMap((d) => d.evidence);
  const positives = allEvidence.filter((e) => e.points > 0);
  const negatives = allEvidence.filter((e) => e.points < 0);
  const neutrals = allEvidence.filter((e) => e.points === 0);

  return (
    <Card id="why">
      <CardHeader>
        <div>
          <CardTitle>Why {displayScore}/10?</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            Computed {formatDateTime(computedAt)} · model {modelVersion} · composite {composite}/100
          </p>
        </div>
        <ScoreDial score={displayScore} size="lg" />
      </CardHeader>

      <CardContent className="space-y-3">
        {isOverridden ? (
          <div className="rounded-md border border-warning-border bg-warning-subtle px-3 py-2">
            <p className="text-xs font-medium text-warning-text">
              Manually overridden to {displayScore} — the engine computed {rawScore}
            </p>
            {overrideReason ? (
              <p className="mt-0.5 text-2xs text-warning-text/90">{overrideReason}</p>
            ) : null}
          </div>
        ) : null}

        {/* Summary of the evidence ledger */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="success">{positives.length} positive</Badge>
          {negatives.length > 0 ? <Badge variant="danger">{negatives.length} negative</Badge> : null}
          {neutrals.length > 0 ? <Badge variant="neutral">{neutrals.length} noted, no effect</Badge> : null}
        </div>

        <ul className="space-y-2.5">
          {dimensions.map((d) => {
            const isOpen = expanded.has(d.key);
            return (
              <li key={d.key} className="rounded-md border border-border-subtle">
                <button
                  type="button"
                  onClick={() => toggle(d.key)}
                  aria-expanded={isOpen}
                  className="w-full px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                      {d.label}
                      <Tooltip content={d.question}>
                        <Info className="size-3 text-muted" />
                      </Tooltip>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-2xs text-muted">
                        {d.evidence.length} {d.evidence.length === 1 ? "item" : "items"}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-semibold tabular",
                          d.value >= 70
                            ? "text-success-text"
                            : d.value >= 40
                              ? "text-secondary"
                              : "text-danger-text"
                        )}
                      >
                        {d.value}
                      </span>
                    </span>
                  </div>
                  <Progress
                    value={d.value}
                    size="xs"
                    className="mt-1.5"
                    label={`${d.label}: ${d.value} of 100`}
                    barClassName={
                      d.value >= 70 ? "bg-success" : d.value >= 40 ? "bg-brand" : "bg-warning"
                    }
                  />
                </button>

                {isOpen ? (
                  <ul className="space-y-1.5 border-t border-border-subtle bg-surface-sunken px-2.5 py-2">
                    {d.evidence.length === 0 ? (
                      <li className="text-2xs text-muted">
                        No evidence found for this dimension, which is why it scores {d.value}.
                      </li>
                    ) : (
                      d.evidence.map((e, i) => (
                        <li key={i} className="flex gap-2">
                          <span
                            className={cn(
                              "w-7 shrink-0 text-right font-mono text-2xs font-semibold tabular",
                              e.points > 0
                                ? "text-success-text"
                                : e.points < 0
                                  ? "text-danger-text"
                                  : "text-muted"
                            )}
                          >
                            {e.points > 0 ? `+${e.points}` : e.points}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-2xs leading-relaxed text-secondary">
                              {e.label}
                            </span>
                            {e.detail ? (
                              <span className="block text-2xs leading-relaxed text-muted">
                                {e.detail}
                              </span>
                            ) : null}
                            <span className="mt-0.5 block font-mono text-2xs text-muted/70">
                              {e.sourceType}
                            </span>
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
          <ScoreOverrideDialog
            leadId={leadId}
            computedScore={rawScore}
            currentOverride={isOverridden ? displayScore : null}
          />
          <p className="text-2xs text-muted">
            Overrides are stored as feedback and shape future scoring for this workspace.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
