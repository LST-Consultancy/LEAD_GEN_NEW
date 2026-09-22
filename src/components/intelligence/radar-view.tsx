"use client";

import { AlertTriangle, Bell, BellOff, Eye, Info, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { SignalNotice } from "@/components/intelligence/signal-notice";
import { formatAge } from "@/lib/format";

type Watch = {
  id: string;
  targetKind: string;
  targetLabel: string;
  targetId: string | null;
  frequency: string;
  alertOn: string[];
  stage: string;
  confidence: number;
  isActive: boolean;
  lastAlertAt: string | null;
  createdAt: string;
  signalsSeen: number;
};

const KIND_LABEL: Record<string, string> = {
  PERSON: "person",
  COMPANY: "company",
  KEYWORD: "keyword",
  TECHNOLOGY: "technology",
  COMPETITOR: "competitor",
};

const STAGE_META: Record<string, { label: string; variant: "neutral" | "info" | "warning" | "success" }> = {
  AWARE: { label: "Aware", variant: "neutral" },
  INTERESTED: { label: "Interested", variant: "info" },
  EVALUATING: { label: "Evaluating", variant: "warning" },
  READY: { label: "Ready", variant: "success" },
};

export function RadarView({
  watches,
  freshness,
}: {
  watches: Watch[];
  freshness: { connected: boolean; notice: string };
}) {
  const active = watches.filter((w) => w.isActive);
  const neverFired = active.filter((w) => w.lastAlertAt === null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Radar</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Continuous monitoring of the people, accounts, keywords and technologies you care
          about.
        </p>
      </div>

      <SignalNotice freshness={freshness} />

      {!freshness.connected && active.length > 0 ? (
        <div className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-xs text-danger-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>
            {active.length} {active.length === 1 ? "watch is" : "watches are"} switched on, but
            nothing feeds them.
          </strong>{" "}
          Monitoring needs a discovery source — a licensed dataset, a job-board feed, a tender
          portal — and none is connected. These are real configurations that will start working
          the moment one is, not decoration.
        </div>
      ) : null}

      {watches.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Target}
              title="Nothing being watched"
              description="A watch is a standing instruction: tell me when this company posts a job, when this keyword appears, when this technology shows up somewhere new."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="Watches" value={String(watches.length)} hint={`${active.length} active`} />
            <Stat
              label="Never fired"
              value={String(neverFired.length)}
              hint="no alert yet"
            />
            <Stat
              label="Signals seen"
              value={String(watches.reduce((n, w) => n + w.signalsSeen, 0))}
              hint="against watched companies"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Watches</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border-subtle">
                {watches.map((w) => {
                  const stage = STAGE_META[w.stage] ?? STAGE_META.AWARE;
                  return (
                    <li key={w.id} className="flex flex-wrap items-start gap-2 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {w.isActive ? (
                            <Bell className="size-3 text-success-text" />
                          ) : (
                            <BellOff className="size-3 text-muted" />
                          )}
                          <span className="text-xs font-medium text-primary">{w.targetLabel}</span>
                          <Badge variant="neutral" size="sm">
                            {KIND_LABEL[w.targetKind] ?? w.targetKind.toLowerCase()}
                          </Badge>
                          <Tooltip content="How far along this target is thought to be — inferred from signals, not stated by them.">
                            <span className="cursor-help">
                              <Badge variant={stage.variant} size="sm">
                                {stage.label}
                              </Badge>
                            </span>
                          </Tooltip>
                        </div>
                        <p className="mt-0.5 text-2xs text-muted">
                          {w.alertOn.length > 0
                            ? `Alerts on ${w.alertOn.join(", ").toLowerCase()}`
                            : "No alert conditions set — it would never fire even with a source"}
                          {" · "}
                          {w.frequency.toLowerCase()}
                          {" · "}
                          {w.lastAlertAt
                            ? `last alert ${formatAge(w.lastAlertAt)}`
                            : "never alerted"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Tooltip content="Signals recorded against this target so far. A company watch counts its company's signals; a keyword watch has nothing to count against until a source is connected.">
                          <span className="cursor-help text-2xs text-muted">
                            <Eye className="mr-0.5 inline size-2.5" />
                            {w.signalsSeen}
                          </span>
                        </Tooltip>
                        <p className="text-2xs text-muted">confidence {w.confidence}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <p className="text-2xs text-muted">
            <Info className="mr-0.5 inline size-2.5" />
            A watch with no alert conditions never fires, whatever else is connected. Those are
            named above rather than left looking armed.
          </p>
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
