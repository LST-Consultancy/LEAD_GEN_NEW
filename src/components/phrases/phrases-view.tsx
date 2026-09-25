"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Info,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { Metric } from "@/components/charts/metric";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { TagInput } from "@/components/icp/tag-input";
import { ApiError, api } from "@/lib/api/client";
import { formatAge, formatInrCompact } from "@/lib/format";
import { SIGNAL_SOURCE_LABEL } from "@/lib/vocab";
import { cn } from "@/lib/utils";

type Phrase = {
  id: string;
  phrase: string;
  sourceKind: string;
  isActive: boolean;
  cadenceHours: number;
  negativeKeywords: string[];
  createdByAi: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  signalCount: number;
  runCount: number;
  lastRun: { state: string; startedAt: string; signalsFound: number; errorMessage: string | null } | null;
  analytics: {
    leads: number;
    tierA: number;
    tierAPct: number | null;
    avgScore: number | null;
    contacted: number;
    replied: number;
    replyRate: number | null;
    dealCount: number;
    dealInr: number;
    wonCount: number;
    wonInr: number;
  };
};

type Verdicts = {
  verdicts: { id: string; phrase: string; verdict: string; note: string }[];
  summary: { proven: number; promising: number; underperforming: number; insufficient: number };
};

const SOURCE_OPTIONS = [
  "SOCIAL_PUBLIC",
  "JOB_BOARD",
  "PUBLIC_WEB",
  "NEWS",
  "TENDER_PORTAL",
  "COMPANY_SITE",
  "LICENSED_DATASET",
  "USER_INTEGRATION",
  "USER_MANUAL",
];

const VERDICT_META: Record<
  string,
  { label: string; variant: "success" | "brand" | "danger" | "neutral"; icon: React.ComponentType<{ className?: string }> }
> = {
  proven: { label: "Proven", variant: "success", icon: CheckCircle2 },
  promising: { label: "Promising", variant: "brand", icon: TrendingUp },
  underperforming: { label: "Underperforming", variant: "danger", icon: TrendingDown },
  acceptable: { label: "Acceptable", variant: "neutral", icon: Info },
  insufficient_data: { label: "Too early", variant: "neutral", icon: HelpCircle },
};

export function PhrasesView({
  phrases,
  verdicts,
  watchability,
}: {
  phrases: Phrase[];
  verdicts: Verdicts;
  watchability: Record<string, { providers: string[]; reason: string | null }>;
}) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<Phrase | null>(null);

  const verdictById = new Map(verdicts.verdicts.map((v) => [v.id, v]));
  const active = phrases.filter((p) => p.isActive).length;

  const totals = phrases.reduce(
    (acc, p) => ({
      leads: acc.leads + p.analytics.leads,
      tierA: acc.tierA + p.analytics.tierA,
      wonInr: acc.wonInr + p.analytics.wonInr,
      wonCount: acc.wonCount + p.analytics.wonCount,
    }),
    { leads: 0, tierA: 0, wonInr: 0, wonCount: 0 }
  );

  async function runNow(p: Phrase) {
    setBusy(p.id);
    try {
      const r = await api.post<{ note: string | null }>(`/api/search-phrases/${p.id}/run`, {});
      toast.success("Phrase run started", { description: r.note ?? `"${p.phrase}"` });
      router.refresh();
    } catch (e) {
      toast.error("Could not run it", { description: e instanceof Error ? e.message : "Nothing was run or charged." });
    } finally {
      setBusy(null);
    }
  }
  async function toggle(p: Phrase) {
    setBusy(p.id);
    try {
      await api.patch(`/api/search-phrases/${p.id}`, { isActive: !p.isActive });
      toast.success(p.isActive ? "Paused" : "Resumed", { description: `"${p.phrase}"` });
      router.refresh();
    } catch (err) {
      toast.error("Couldn't change that", {
        description: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: Phrase) {
    setBusy(p.id);
    try {
      const result = await api.del<{ note?: string }>(`/api/search-phrases/${p.id}`);
      toast.success("Stopped watching", { description: result.note ?? `"${p.phrase}"` });
      setConfirmDelete(null);
      router.refresh();
    } catch (err) {
      toast.error("Couldn't remove that", {
        description: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-primary">Search phrases</h1>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-secondary">
            The queries that feed your radar. Each one is tracked from signal through to won
            revenue, so a phrase that produces volume but never converts is visible as such.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus />
          Add a phrase
        </Button>
      </header>

      {/* A phrase runs only where a matching discovery source is connected. Say which, per phrase. */}
      {phrases.length > 0 && !Object.values(watchability).some(w => w.providers.length) ? (
        <Card className="border-warning-border bg-warning-subtle">
          <CardContent className="pt-3.5">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-warning-text">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>None of these phrases can run yet</strong>: no discovery source for their
                kind is connected with search and storage rights. Each row says which to connect.
                Attribution below still works over data already in the workspace.
              </span>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Portfolio summary */}
      {phrases.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Metric label="Phrases" value={String(phrases.length)} sub={`${active} active`} size="sm" />
          <Metric label="Leads produced" value={String(totals.leads)} size="sm" />
          <Metric
            label="Tier A produced"
            value={String(totals.tierA)}
            sub={totals.leads > 0 ? `${Math.round((totals.tierA / totals.leads) * 100)}% of all` : undefined}
            size="sm"
            tone="brand"
          />
          <Metric
            label="Revenue attributed"
            value={totals.wonInr > 0 ? formatInrCompact(totals.wonInr) : "—"}
            sub={`${totals.wonCount} won`}
            size="sm"
            tone="good"
            hint="Won deals whose lead was first surfaced by one of these phrases. Traced through the lead record, not estimated."
          />
          <Metric
            label="Need attention"
            value={String(verdicts.summary.underperforming)}
            sub="underperforming"
            size="sm"
            tone={verdicts.summary.underperforming > 0 ? "warning" : "good"}
          />
        </div>
      ) : null}

      {/* The table */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Phrase performance</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              Signal → lead → contacted → replied → deal → won, per phrase.
              Replies show as replied/sent.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-0">
          {phrases.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No search phrases yet"
              description="A phrase is a pattern worth watching for — someone asking publicly for what you sell, a job opening that implies a project, a published tender. Describe who you sell to and we'll propose some."
              action={
                <Button size="sm" variant="primary" asChild>
                  <Link href="/find-leads">Generate from my ICP</Link>
                </Button>
              }
              secondaryAction={
                <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
                  Write one myself
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">Search phrases and their funnel performance</caption>
                <thead className="bg-surface-sunken">
                  <tr className="border-y border-border">
                    {[
                      ["Phrase", "left", ""],
                      ["Source", "left", ""],
                      ["Leads", "right", ""],
                      ["Tier A", "right", ""],
                      ["Avg score", "right", ""],
                      // Merged: the two numbers are only meaningful as a
                      // ratio, and ten columns did not fit the settings layout.
                      // The header stays short because it sets the column width.
                      ["Replied", "right", ""],
                      ["Won", "right", ""],
                      ["Verdict", "left", ""],
                      ["", "right", ""],
                    ].map(([label, align, sticky], i) => (
                      <th
                        key={i}
                        scope="col"
                        className={cn(
                          "whitespace-nowrap px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted",
                          align === "right" ? "text-right" : "text-left",
                          sticky
                        )}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {phrases.map((p) => {
                    const a = p.analytics;
                    const v = verdictById.get(p.id);
                    const meta = v ? VERDICT_META[v.verdict] : null;
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          "border-b border-border-subtle last:border-0",
                          !p.isActive && "opacity-60"
                        )}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-start gap-1.5">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-primary">
                                &ldquo;{p.phrase}&rdquo;
                              </p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
                                {!p.isActive ? (
                                  <Badge variant="neutral" size="sm" uppercase>
                                    Paused
                                  </Badge>
                                ) : null}
                                {p.createdByAi ? (
                                  <Badge variant="ai" size="sm" uppercase>
                                    Suggested
                                  </Badge>
                                ) : null}
                                <span>every {p.cadenceHours}h</span>
                                {p.negativeKeywords.length > 0 ? (
                                  <Tooltip
                                    content={`Excludes: ${p.negativeKeywords.join(", ")}`}
                                  >
                                    <span className="cursor-help">
                                      −{p.negativeKeywords.length} negative
                                    </span>
                                  </Tooltip>
                                ) : null}
                                {p.lastRunAt ? <span>ran {formatAge(p.lastRunAt)}</span> : null}
                              </p>
                              <p className="text-2xs text-secondary">
                                {watchability[p.id]?.providers.length
                                  ? `Runs on ${watchability[p.id].providers.join(", ")}${p.isActive ? ` every ${p.cadenceHours}h` : " when resumed"}`
                                  : watchability[p.id]?.reason ?? ""}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="whitespace-nowrap px-3 py-2 text-2xs text-secondary">
                          {SIGNAL_SOURCE_LABEL[p.sourceKind] ?? p.sourceKind}
                        </td>

                        <td className="px-3 py-2 text-right text-secondary tabular">{a.leads}</td>
                        <td className="px-3 py-2 text-right tabular">
                          <span className="font-medium text-primary">{a.tierA}</span>
                          {a.tierAPct !== null ? (
                            <span className="ml-1 text-2xs text-muted">{a.tierAPct}%</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right text-secondary tabular">
                          {a.avgScore !== null ? a.avgScore.toFixed(1) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular">
                          {a.contacted === 0 ? (
                            // Not "0%" — nothing was sent, so there is no rate
                            // to report.
                            <span className="text-2xs text-muted">not sent</span>
                          ) : (
                            <>
                              <span className="text-secondary">
                                {a.replied}/{a.contacted}
                              </span>
                              {a.replyRate !== null ? (
                                <span
                                  className={cn(
                                    "ml-1 text-2xs",
                                    a.replyRate >= 15
                                      ? "text-success-text"
                                      : a.replyRate >= 5
                                        ? "text-muted"
                                        : "text-danger-text"
                                  )}
                                >
                                  {a.replyRate}%
                                </span>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular">
                          {a.wonInr > 0 ? (
                            <span className="font-semibold text-success-text">
                              {formatInrCompact(a.wonInr)}
                            </span>
                          ) : (
                            <span className="text-2xs text-muted">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2">
                          {meta && v ? (
                            <Tooltip content={v.note}>
                              <span className="inline-flex cursor-help items-center gap-1">
                                <meta.icon className="size-3" />
                                <Badge variant={meta.variant} size="sm">
                                  {meta.label}
                                </Badge>
                              </span>
                            </Tooltip>
                          ) : null}
                        </td>

                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <span className="inline-flex gap-0.5">
                            <Tooltip content={p.isActive ? "Pause" : "Resume"}>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                disabled={busy === p.id}
                                onClick={() => void toggle(p)}
                                aria-label={p.isActive ? "Pause phrase" : "Resume phrase"}
                              >
                                {p.isActive ? <Pause /> : <Play />}
                              </Button>
                            </Tooltip>
                            <Tooltip content={watchability[p.id]?.providers.length ? "Run now" : watchability[p.id]?.reason ?? "Cannot run"}>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                disabled={busy === p.id || !watchability[p.id]?.providers.length}
                                onClick={() => void runNow(p)}
                                aria-label="Run phrase now"
                              >
                                <RefreshCw />
                              </Button>
                            </Tooltip>
                            <Tooltip content="Stop watching this phrase">
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                disabled={busy === p.id}
                                onClick={() => setConfirmDelete(p)}
                                aria-label="Remove phrase"
                              >
                                <Trash2 />
                              </Button>
                            </Tooltip>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
        {phrases.length > 0 ? (
          <CardFooter>
            <p className="text-2xs leading-relaxed text-muted">
              A verdict needs at least five leads before it says anything. Reply rate is only
              computed once something was actually sent, so a blank is &ldquo;not measured&rdquo;
              rather than zero.
            </p>
          </CardFooter>
        ) : null}
      </Card>

      {/* §33 — what to do about the portfolio */}
      {verdicts.verdicts.some((v) => v.verdict !== "insufficient_data") ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-ai-accent" />
                What the numbers say
              </CardTitle>
              <p className="mt-0.5 text-2xs text-muted">
                Derived from the table above — no model involved
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {verdicts.verdicts
                .filter((v) => v.verdict !== "acceptable" && v.verdict !== "insufficient_data")
                .map((v) => {
                  const meta = VERDICT_META[v.verdict];
                  return (
                    <li
                      key={v.id}
                      className={cn(
                        "rounded-md border px-2.5 py-2",
                        v.verdict === "proven"
                          ? "border-success-border bg-success-subtle"
                          : v.verdict === "promising"
                            ? "border-brand-border bg-brand-subtle"
                            : "border-danger-border bg-danger-subtle"
                      )}
                    >
                      <p
                        className={cn(
                          "flex items-center gap-1.5 text-2xs font-semibold",
                          v.verdict === "proven"
                            ? "text-success-text"
                            : v.verdict === "promising"
                              ? "text-brand-text"
                              : "text-danger-text"
                        )}
                      >
                        <meta.icon className="size-3" />
                        {meta.label}: &ldquo;{v.phrase}&rdquo;
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 text-2xs leading-relaxed",
                          v.verdict === "underperforming" ? "text-danger-text/90" : "text-secondary"
                        )}
                      >
                        {v.note}
                      </p>
                    </li>
                  );
                })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <PhraseDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setCreating(false);
          router.refresh();
        }}
      />

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Stop watching this phrase?</DialogTitle>
            <DialogDescription>
              Leads it already produced keep their attribution, so historical revenue does not lose
              its origin.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-xs text-secondary">&ldquo;{confirmDelete?.phrase}&rdquo;</p>
            {confirmDelete && confirmDelete.analytics.leads > 0 ? (
              <p className="mt-1.5 text-2xs text-muted">
                {confirmDelete.analytics.leads} leads are attributed to it.
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busy === confirmDelete?.id}
              onClick={() => confirmDelete && void remove(confirmDelete)}
            >
              Stop watching
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PhraseDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [phrase, setPhrase] = React.useState("");
  const [sourceKind, setSourceKind] = React.useState("SOCIAL_PUBLIC");
  const [cadence, setCadence] = React.useState(24);
  const [negatives, setNegatives] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setPhrase("");
      setSourceKind("SOCIAL_PUBLIC");
      setCadence(24);
      setNegatives([]);
    }
  }, [open]);

  async function submit() {
    setSaving(true);
    try {
      await api.post("/api/search-phrases", {
        phrase: phrase.trim(),
        sourceKind,
        cadenceHours: cadence,
        negativeKeywords: negatives,
        isActive: true,
      });
      toast.success("Now watching that phrase");
      onCreated();
    } catch (err) {
      toast.error("Couldn't add that phrase", {
        description: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a search phrase</DialogTitle>
          <DialogDescription>
            Write it the way a buyer would, not the way you would describe your product. &ldquo;We
            need a Salesforce partner&rdquo; finds buyers; &ldquo;Salesforce consulting
            services&rdquo; finds competitors.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <Field label="Phrase" htmlFor="phrase" required>
            <Input
              id="phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="looking for Salesforce implementation partner"
              autoFocus
            />
          </Field>

          <Field
            label="Where to watch"
            htmlFor="source"
            hint="Job boards indicate approved budget. Tender portals are the highest-confidence intent there is."
          >
            <Select value={sourceKind} onValueChange={setSourceKind}>
              <SelectTrigger id="source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SIGNAL_SOURCE_LABEL[s] ?? s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="How often"
            htmlFor="cadence"
            hint="Hours between runs. More frequent costs more and rarely finds more."
          >
            <Input
              id="cadence"
              type="number"
              min={1}
              max={720}
              value={cadence}
              onChange={(e) => setCadence(Number(e.target.value))}
            />
          </Field>

          <TagInput
            label="Negative keywords"
            hint="Terms that mean a match is not a buyer — job seekers, training courses, your own competitors."
            values={negatives}
            onChange={setNegatives}
            tone="danger"
            placeholder="internship"
          />
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={phrase.trim().length < 3}
            onClick={submit}
          >
            Start watching
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
