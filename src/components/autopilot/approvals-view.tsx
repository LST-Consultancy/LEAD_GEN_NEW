"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Coins,
  Info,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatAge, formatNumber } from "@/lib/format";

type Pending = {
  id: string;
  kind: "agent_action" | "message";
  riskClass: string;
  title: string;
  detail: string | null;
  pointsCost: number;
  executable: boolean;
  blockedBecause: string | null;
  actor: string;
  leadId: string | null;
  leadName: string | null;
  companyName: string | null;
  occurredAt: string;
};

type Summary = {
  total: number;
  willRun: number;
  cannotRun: number;
  pointsAtStake: number;
  byRisk: Record<string, number>;
  companies: string[];
  blockedReasons: string[];
};

const RISK_VARIANT: Record<string, "neutral" | "warning" | "danger" | "info"> = {
  READ: "neutral",
  WRITE: "info",
  SPEND: "warning",
  EXTERNAL: "danger",
};

export function ApprovalsView({
  pending,
  summary,
  canApprove,
}: {
  pending: Pending[];
  summary: Summary;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [result, setResult] = useState<{
    note: string;
    skipped: { title: string; reason: string }[];
    failed: { title: string; reason: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const chosen = pending.filter((p) => selected.has(p.id));
  // The summary describes exactly what the button will act on: the selection
  // when there is one, otherwise the whole queue.
  const scopeSummary: Summary =
    chosen.length > 0
      ? {
          total: chosen.length,
          willRun: chosen.filter((p) => p.executable).length,
          cannotRun: chosen.filter((p) => !p.executable).length,
          pointsAtStake: chosen.filter((p) => p.executable).reduce((n, p) => n + p.pointsCost, 0),
          byRisk: chosen
            .filter((p) => p.executable)
            .reduce<Record<string, number>>((acc, p) => {
              acc[p.riskClass] = (acc[p.riskClass] ?? 0) + 1;
              return acc;
            }, {}),
          companies: [...new Set(chosen.map((p) => p.companyName).filter(Boolean))] as string[],
          blockedReasons: [
            ...new Set(chosen.filter((p) => !p.executable).map((p) => p.blockedBecause)),
          ].filter(Boolean) as string[],
        }
      : summary;

  const decideOne = async (item: Pending, decision: "approve" | "reject") => {
    setBusy(item.id);
    setError(null);
    setResult(null);
    try {
      const path =
        item.kind === "message"
          ? `/api/messages/${item.id}/decide`
          : `/api/agent-actions/${item.id}/decide`;
      const res = await api.post<{ note: string }>(path, {
        decision,
        reason: decision === "reject" ? reason : undefined,
      });
      setRejecting(null);
      setReason("");
      setResult({ note: res.note, skipped: [], failed: [] });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  const approveAll = async () => {
    setBusy("bulk");
    setError(null);
    try {
      const res = await api.post<{
        note: string;
        skipped: { title: string; reason: string }[];
        failed: { title: string; reason: string }[];
      }>("/api/approvals/bulk", chosen.length > 0 ? { ids: chosen.map((c) => c.id) } : {});
      setResult(res);
      setBulkOpen(false);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Approval Center</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Everything waiting on a person, whatever produced it — an agent&apos;s action or a
          drafted message. Approving re-checks the guardrails at the moment it runs.
        </p>
      </div>

      {!canApprove ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-text">
          <Info className="mr-1 inline size-3.5" />
          Your role cannot approve automated actions. You can see what is waiting, but the
          buttons are not yours to press.
        </div>
      ) : null}

      {pending.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={ShieldCheck}
              title="Nothing waiting"
              description="When an agent does work it is not allowed to complete on its own, or drafts a message that needs a person, it lands here with what it would do and what it would cost."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Waiting" value={formatNumber(summary.total)} hint="items" />
            <Stat
              label="Would run"
              value={formatNumber(summary.willRun)}
              hint="if approved now"
            />
            <Stat
              label="Cannot run"
              value={formatNumber(summary.cannotRun)}
              hint="nothing would happen"
            />
            <Stat
              label="Points at stake"
              value={formatNumber(summary.pointsAtStake)}
              hint="if you approve all"
            />
          </div>

          {canApprove ? (
            <Card>
              <CardContent className="flex flex-col gap-2 py-3">
                {bulkOpen ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold text-primary">
                      {chosen.length > 0
                        ? `Approve the ${chosen.length} selected?`
                        : `Approve everything waiting?`}
                    </p>
                    <ul className="flex flex-col gap-1 text-2xs text-secondary">
                      <li>
                        <Check className="mr-1 inline size-2.5 text-success-text" />
                        <strong className="text-primary">{scopeSummary.willRun}</strong> will run.
                        {Object.entries(scopeSummary.byRisk).length > 0 ? (
                          <span className="ml-1 text-muted">
                            (
                            {Object.entries(scopeSummary.byRisk)
                              .map(([risk, n]) => `${n} ${risk.toLowerCase()}`)
                              .join(", ")}
                            )
                          </span>
                        ) : null}
                      </li>
                      {scopeSummary.pointsAtStake > 0 ? (
                        <li>
                          <Coins className="mr-1 inline size-2.5 text-warning-text" />
                          <strong className="text-primary">
                            {scopeSummary.pointsAtStake} points
                          </strong>{" "}
                          will leave your balance. This cannot be undone by editing a record.
                        </li>
                      ) : null}
                      {scopeSummary.companies.length > 0 ? (
                        <li className="text-muted">
                          Touching: {scopeSummary.companies.slice(0, 6).join(", ")}
                          {scopeSummary.companies.length > 6
                            ? ` and ${scopeSummary.companies.length - 6} more`
                            : ""}
                        </li>
                      ) : null}
                      {scopeSummary.cannotRun > 0 ? (
                        <li className="text-warning-text">
                          <AlertTriangle className="mr-1 inline size-2.5" />
                          {scopeSummary.cannotRun} will be left queued, because nothing would
                          happen: {scopeSummary.blockedReasons.join(" ")}
                        </li>
                      ) : null}
                    </ul>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy !== null || scopeSummary.willRun === 0}
                        onClick={() => void approveAll()}
                      >
                        <CheckCheck />
                        {scopeSummary.willRun === 0
                          ? "Nothing would run"
                          : `Approve ${scopeSummary.willRun} and run`}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setBulkOpen(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => setBulkOpen(true)}
                    >
                      <CheckCheck />
                      {chosen.length > 0 ? `Approve ${chosen.length} selected` : "Approve all"}
                    </Button>
                    <span className="text-2xs text-muted">
                      You will see exactly what will happen before anything does.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {error ? (
            <p className="rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger-text">
              {error}
            </p>
          ) : null}

          {result ? (
            <div className="rounded-lg border border-info-border bg-info-subtle px-3 py-2.5 text-xs text-info-text">
              {result.note}
              {result.skipped.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {result.skipped.map((s, i) => (
                    <li key={i} className="text-2xs">
                      Left queued — {s.title}: {s.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              {result.failed.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {result.failed.map((f, i) => (
                    <li key={i} className="text-2xs text-danger-text">
                      Failed — {f.title}: {f.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Waiting on a person</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {pending.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-md border p-2.5",
                    p.executable
                      ? "border-border-subtle bg-surface-sunken"
                      : "border-warning-border bg-warning-surface/40"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {canApprove ? (
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={(v) => {
                          const next = new Set(selected);
                          if (v) next.add(p.id);
                          else next.delete(p.id);
                          setSelected(next);
                        }}
                        aria-label={`Select ${p.title}`}
                        className="mt-0.5"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={RISK_VARIANT[p.riskClass] ?? "neutral"} size="sm">
                          {p.riskClass}
                        </Badge>
                        <span className="text-xs font-medium text-primary">{p.title}</span>
                        {p.pointsCost > 0 ? (
                          <span className="text-2xs text-warning-text">
                            {p.pointsCost} points
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-2xs text-muted">
                        {p.actor}
                        {p.detail ? ` · ${p.detail}` : ""} · {formatAge(p.occurredAt)}
                        {p.leadName ? (
                          <>
                            {" · "}
                            {p.leadId ? (
                              <Link href={`/leads/${p.leadId}`} className="hover:underline">
                                {p.leadName}
                              </Link>
                            ) : (
                              p.leadName
                            )}
                            {p.companyName ? ` at ${p.companyName}` : ""}
                          </>
                        ) : null}
                      </p>
                      {p.blockedBecause ? (
                        <p className="mt-1 text-2xs text-warning-text">
                          <AlertTriangle className="mr-0.5 inline size-2.5" />
                          {p.blockedBecause}
                        </p>
                      ) : null}

                      {canApprove ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {rejecting === p.id ? (
                            <>
                              <Input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Why are you overruling this?"
                                className="max-w-sm text-xs"
                              />
                              <Button
                                size="xs"
                                variant="danger"
                                disabled={busy === p.id || reason.trim().length < 3}
                                onClick={() => void decideOne(p, "reject")}
                              >
                                Confirm
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => setRejecting(null)}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Tooltip
                                content={
                                  p.executable
                                    ? "Approving runs it now, after re-checking the guardrails."
                                    : "Nothing would happen, so this cannot be approved."
                                }
                              >
                                <Button
                                  size="xs"
                                  variant="primary"
                                  disabled={busy === p.id || !p.executable}
                                  onClick={() => void decideOne(p, "approve")}
                                >
                                  <Check />
                                  Approve
                                </Button>
                              </Tooltip>
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => setRejecting(p.id)}
                              >
                                <X />
                                Overrule
                              </Button>
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
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
