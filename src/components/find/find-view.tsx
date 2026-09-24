"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Info,
  Plug,
  Sparkles,
  Target,
  Upload,
  Wand2,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { Metric } from "@/components/charts/metric";
import { ApiError, api } from "@/lib/api/client";
import { FIELD_LABEL, type Extraction, type ExtractionField } from "@/lib/icp/extract";
import type { SourceDescriptor } from "@/lib/ingest/sources";
import type { ProviderReadiness } from "@/lib/services/capabilities";
import { PROVIDER_STATE_LABEL } from "@/lib/vocab";
import { SIGNAL_SOURCE_LABEL } from "@/lib/vocab";
import { cn } from "@/lib/utils";

type ExtractResponse = Extraction & {
  preview: {
    matching: number;
    total: number;
    techOverlap: number;
    sample: {
      id: string;
      name: string;
      company: string;
      score: number | null;
      sharesTechnology: boolean;
    }[];
    note: string;
  };
};

const EXAMPLE =
  "I sell Salesforce implementation to Indian manufacturing businesses with 100–1000 employees " +
  "that are actively hiring Salesforce administrators or mentioning CRM migration.";

export function FindView({
  hasIcp,
  sources,
}: {
  hasIcp: boolean;
  sources: { available: SourceDescriptor[]; pending: SourceDescriptor[]; connected: ProviderReadiness[] };
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-3 py-4 sm:px-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-primary">Find leads</h1>
        <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-secondary">
          Describe who you sell to and this turns it into a scoring definition and a set of phrases
          worth watching. Bring your own list in the meantime.
        </p>
      </header>

      <Tabs defaultValue="describe">
        <TabsList>
          <TabsTrigger value="describe">
            <Wand2 className="size-3.5" />
            Describe your buyer
          </TabsTrigger>
          <TabsTrigger value="import">
            <Upload className="size-3.5" />
            Import a list
          </TabsTrigger>
          <TabsTrigger value="sources">
            <Plug className="size-3.5" />
            Sources
          </TabsTrigger>
        </TabsList>

        <TabsContent value="describe" className="pt-3">
          <DescribeTab hasIcp={hasIcp} />
        </TabsContent>
        <TabsContent value="import" className="pt-3">
          <ImportTab hasIcp={hasIcp} />
        </TabsContent>
        <TabsContent value="sources" className="pt-3">
          <SourcesTab sources={sources} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Describe
// ---------------------------------------------------------------------------

function DescribeTab({ hasIcp }: { hasIcp: boolean }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [result, setResult] = React.useState<ExtractResponse | null>(null);
  const [working, setWorking] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [chosenPhrases, setChosenPhrases] = React.useState<Set<string>>(new Set());

  async function extract() {
    setWorking(true);
    setResult(null);
    try {
      const r = await api.post<ExtractResponse>("/api/find/extract", { text: text.trim() });
      setResult(r);
      setChosenPhrases(new Set(r.suggestedPhrases.map((p) => p.phrase)));
      setName(
        r.draft.industries.length > 0
          ? `${r.draft.industries.slice(0, 2).join(" & ")}${r.draft.employeeMin ? ` (${r.draft.employeeMin}+)` : ""}`
          : "New profile"
      );
    } catch (err) {
      toast.error("Couldn't read that", {
        description: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setWorking(false);
    }
  }

  async function save() {
    if (!result) return;
    setSaving(true);
    try {
      const profile = await api.post<{ id: string }>("/api/icp", {
        name: name.trim() || "New profile",
        sellsDescription: result.draft.sellsDescription,
        industries: result.draft.industries,
        locations: result.draft.locations,
        employeeMin: result.draft.employeeMin,
        employeeMax: result.draft.employeeMax,
        buyerRoles: result.draft.buyerRoles,
        seniorities: result.draft.seniorities,
        // Only what the prospect runs goes here. What you sell belongs in the
        // description, where it grounds drafting without skewing fit.
        technologies: result.draft.technologies,
        pains: [],
        triggerEvents: result.draft.triggerEvents,
        exclusions: result.draft.exclusions,
        isPrimary: !hasIcp,
      });

      // Each chosen phrase is created individually so one rejection does not
      // lose the rest.
      const chosen = result.suggestedPhrases.filter((p) => chosenPhrases.has(p.phrase));
      let created = 0;
      for (const p of chosen) {
        try {
          await api.post("/api/search-phrases", {
            phrase: p.phrase,
            sourceKind: p.sourceKind,
            isActive: true,
            cadenceHours: 24,
            negativeKeywords: [],
          });
          created++;
        } catch {
          // A duplicate is the usual cause and is not worth interrupting for.
        }
      }

      toast.success("ICP saved", {
        description:
          created > 0
            ? `${created} search ${created === 1 ? "phrase" : "phrases"} added too.`
            : "No phrases added.",
      });
      router.push("/settings/icp");
      router.refresh();
      void profile;
    } catch (err) {
      toast.error("Couldn't save that", {
        description: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Tell us who you want to sell to</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              Plain sentences. Mention the industry, size, geography, who you talk to, and what
              tells you they are in market.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <Textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE}
            className="text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length >= 10) {
                void extract();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={working}
              disabled={text.trim().length < 10}
              onClick={extract}
            >
              <Sparkles />
              Read this
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setText(EXAMPLE)}>
              Use the example
            </Button>
          </div>

          {/* §126 — say what this is before the user over-trusts it. */}
          <p className="flex items-start gap-1.5 rounded-md bg-surface-sunken px-2.5 py-2 text-2xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3 shrink-0" />
            This matches your words against known industries, places, roles and technologies. It is
            pattern matching, not comprehension — so it shows you every match it made, every field
            you did not mention, and the words it could not place. Check it before saving.
          </p>
        </CardContent>
      </Card>

      {result ? (
        <>
          {/* What it understood */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>What it understood</CardTitle>
                <p className="mt-0.5 text-2xs text-muted">
                  {result.matched.length} {result.matched.length === 1 ? "match" : "matches"}, each
                  traceable to the words that produced it
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.matched.length === 0 ? (
                <p className="rounded-md border border-warning-border bg-warning-subtle px-2.5 py-2 text-xs leading-relaxed text-warning-text">
                  Nothing in that text matched anything it knows. Try naming an industry, a city or
                  state, a job title, or a product you replace.
                </p>
              ) : (
                <ul className="divide-hairline rounded-md border border-border-subtle">
                  {result.matched.map((m, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 px-2.5 py-1.5">
                      <span className="w-36 shrink-0 text-2xs uppercase tracking-wider text-muted">
                        {FIELD_LABEL[m.field]}
                      </span>
                      <span className="text-xs font-medium text-primary">{m.value}</span>
                      <span className="text-2xs text-muted">
                        from &ldquo;{m.from}&rdquo;
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {result.draft.sellsTechnologies.length > 0 ? (
                <p className="flex items-start gap-1.5 rounded-md border border-info-border bg-info-subtle px-2.5 py-2 text-2xs leading-relaxed text-info-text">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  <span>
                    <strong>{result.draft.sellsTechnologies.join(", ")}</strong> was read as
                    something you <em>sell</em>, not something your prospects already run — so it
                    shapes the phrases to watch rather than filtering who matches. An
                    implementation buyer usually does not have it yet.
                  </span>
                </p>
              ) : null}

              {result.missing.length > 0 ? (
                <div>
                  <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                    You did not mention
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {result.missing.map((f) => (
                      <Badge key={f} variant="outline" size="sm">
                        {FIELD_LABEL[f as ExtractionField]}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1 text-2xs text-muted">
                    Left empty rather than guessed. You can fill these in on the ICP screen.
                  </p>
                </div>
              ) : null}

              {result.unmatchedTerms.length > 0 ? (
                <div>
                  <p className="text-2xs font-semibold uppercase tracking-wider text-warning-text">
                    Words it could not place
                  </p>
                  <p className="mt-1 text-2xs leading-relaxed text-secondary">
                    {result.unmatchedTerms.join(", ")}
                  </p>
                  <p className="mt-1 text-2xs text-muted">
                    If any of these matter, add them by hand — as a technology, a trigger event or
                    an industry.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* What it would match */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>What this matches in your data today</CardTitle>
                <p className="mt-0.5 text-2xs text-muted">{result.preview.note}</p>
              </div>
              <Badge
                variant={
                  result.preview.matching === 0
                    ? "warning"
                    : result.preview.matching < 5
                      ? "neutral"
                      : "success"
                }
                size="lg"
              >
                {result.preview.matching} / {result.preview.total}
              </Badge>
            </CardHeader>
            {result.preview.sample.length > 0 ? (
              <CardContent className="space-y-2">
                {result.preview.techOverlap > 0 ? (
                  <p className="text-2xs text-secondary">
                    {result.preview.techOverlap} of these already run a technology you listed, which
                    lifts their fit score.
                  </p>
                ) : null}
                <ul className="space-y-1">
                  {result.preview.sample.map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface px-2.5 py-1.5"
                    >
                      <span className="min-w-0">
                        <Link
                          href={`/leads/${l.id}`}
                          className="block truncate text-xs font-medium text-primary hover:text-brand-text"
                        >
                          {l.name}
                        </Link>
                        <span className="block truncate text-2xs text-muted">{l.company}</span>
                      </span>
                      {l.score !== null ? (
                        <span className="shrink-0 text-xs font-semibold text-secondary tabular">
                          {l.score}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            ) : null}
          </Card>

          {/* Phrases to watch */}
          {result.suggestedPhrases.length > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Phrases worth watching</CardTitle>
                  <p className="mt-0.5 text-2xs text-muted">
                    Built only from terms you actually used — nothing invented
                  </p>
                </div>
                <span className="text-2xs text-muted tabular">
                  {chosenPhrases.size} of {result.suggestedPhrases.length} selected
                </span>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {result.suggestedPhrases.map((p) => {
                    const on = chosenPhrases.has(p.phrase);
                    return (
                      <li key={p.phrase}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors",
                            on
                              ? "border-brand-border bg-brand-subtle"
                              : "border-border-subtle bg-surface hover:border-border-strong"
                          )}
                        >
                          <Checkbox
                            checked={on}
                            onCheckedChange={(c) =>
                              setChosenPhrases((prev) => {
                                const next = new Set(prev);
                                if (c) next.add(p.phrase);
                                else next.delete(p.phrase);
                                return next;
                              })
                            }
                            className="mt-0.5"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-medium text-primary">
                                &ldquo;{p.phrase}&rdquo;
                              </span>
                              <Badge variant="neutral" size="sm">
                                {SIGNAL_SOURCE_LABEL[p.sourceKind] ?? p.sourceKind}
                              </Badge>
                            </span>
                            <span className="mt-0.5 block text-2xs leading-relaxed text-muted">
                              {p.because}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* Save */}
          <Card>
            <CardContent className="space-y-3 pt-3.5">
              <Field label="Name this profile" htmlFor="draft-name" required>
                <Input id="draft-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={saving}
                  disabled={!name.trim() || result.matched.length === 0}
                  onClick={save}
                >
                  <Check />
                  Save ICP{chosenPhrases.size > 0 ? ` and ${chosenPhrases.size} phrases` : ""}
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/settings/icp">
                    Edit by hand instead
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
              {result.matched.length === 0 ? (
                <p className="text-2xs text-warning-text">
                  Nothing was extracted, so there is no definition to save yet.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

type ParseResponse = {
  rows: Record<string, unknown>[];
  errors: { line: number; reason: string }[];
  detectedColumns: string[];
  totalRows: number;
};

function ImportTab({ hasIcp }: { hasIcp: boolean }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [parsed, setParsed] = React.useState<ParseResponse | null>(null);
  const [parsing, setParsing] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  /** Dry run. Uses PUT so it cannot be confused with the real import. */
  async function parse() {
    setParsing(true);
    setParsed(null);
    try {
      const res = await fetch("/api/find/import", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new ApiError(
          body?.error?.message ?? "We couldn't read that list.",
          body?.error?.code ?? "parse_failed",
          res.status
        );
      }
      setParsed(body);
    } catch (err) {
      toast.error("Couldn't read that list", {
        description: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setParsing(false);
    }
  }

  async function runImport() {
    setImporting(true);
    try {
      // The text goes over once; the server re-parses it, so the full row set
      // never round-trips through the browser.
      const result = await api.post<{
        imported: number;
        skipped: { row: number; name: string; reason: string }[];
        note: string;
      }>("/api/find/import", {
        text,
        sourceLabel: label.trim() || "Manual import",
        assignToMe: true,
      });

      toast.success(`${result.imported} ${result.imported === 1 ? "lead" : "leads"} imported`, {
        description: result.note,
      });
      for (const s of result.skipped.slice(0, 3)) {
        toast.warning(`Row ${s.row} skipped`, { description: `${s.name} — ${s.reason}` });
      }
      setText("");
      setParsed(null);
      router.push("/leads?sort=surfaced");
      router.refresh();
    } catch (err) {
      toast.error("Import failed", {
        description: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setImporting(false);
    }
  }

  if (!hasIcp) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-warning-text">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Define an ICP first. Without one there is nothing to score imported leads against,
              and an unscored lead is just a row in a table.
            </span>
          </p>
          <Button variant="primary" size="sm" className="mt-3" asChild>
            <Link href="/settings/icp">Define your ICP</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Paste a list</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              CSV or tab-separated. A header row naming at least <strong>name</strong> and{" "}
              <strong>company</strong> is most reliable.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <Textarea
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`name,company,title,email,city\nPriya Menon,Acme Industries,Head of IT,priya@acme.example,Pune`}
            className="font-mono text-2xs"
          />
          <Field label="Where did this list come from?" htmlFor="src-label" hint="Recorded against every lead so provenance survives.">
            <Input
              id="src-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Trade show attendee list, March 2026"
            />
          </Field>
          <Button
            variant="secondary"
            size="sm"
            loading={parsing}
            disabled={text.trim().length < 5}
            onClick={parse}
          >
            Check the list
          </Button>
        </CardContent>
      </Card>

      {parsed ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>What we read</CardTitle>
              <p className="mt-0.5 text-2xs text-muted">
                Columns matched: {parsed.detectedColumns.join(", ") || "none"}
              </p>
            </div>
            <Badge variant={parsed.totalRows > 0 ? "success" : "danger"} size="lg">
              {parsed.totalRows} usable
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Rows to import" value={String(parsed.totalRows)} size="sm" tone="good" />
              <Metric
                label="Rows rejected"
                value={String(parsed.errors.length)}
                size="sm"
                tone={parsed.errors.length > 0 ? "warning" : "neutral"}
              />
              <Metric label="Columns matched" value={String(parsed.detectedColumns.length)} size="sm" />
            </div>

            {parsed.errors.length > 0 ? (
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wider text-warning-text">
                  Rows we could not use
                </p>
                <ul className="mt-1 space-y-0.5">
                  {parsed.errors.slice(0, 8).map((e, i) => (
                    <li key={i} className="text-2xs text-secondary">
                      Line {e.line}: {e.reason}
                    </li>
                  ))}
                </ul>
                {parsed.errors.length > 8 ? (
                  <p className="mt-0.5 text-2xs text-muted">
                    …and {parsed.errors.length - 8} more. The rest will still import.
                  </p>
                ) : null}
              </div>
            ) : null}

            {parsed.rows.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-border-subtle">
                <table className="w-full text-2xs">
                  <caption className="sr-only">Preview of parsed rows</caption>
                  <thead className="bg-surface-sunken">
                    <tr>
                      {parsed.detectedColumns.map((c) => (
                        <th
                          key={c}
                          scope="col"
                          className="px-2 py-1 text-left font-semibold uppercase tracking-wider text-muted"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 6).map((r, i) => (
                      <tr key={i} className="border-t border-border-subtle">
                        {parsed.detectedColumns.map((c) => (
                          <td key={c} className="px-2 py-1 text-secondary">
                            {String(r[c] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted">
              <Info className="mt-0.5 size-3 shrink-0" />
              Anyone already in your workspace is skipped rather than duplicated. Imported contacts
              are not locked — you supplied them, so no points are charged. Intent stays cold until
              a real buying signal appears.
            </p>
          </CardContent>
          <CardFooter>
            <Button
              variant="primary"
              size="sm"
              loading={importing}
              disabled={parsed.totalRows === 0}
              onClick={runImport}
            >
              <Upload />
              Import {parsed.totalRows} {parsed.totalRows === 1 ? "lead" : "leads"}
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function SourcesTab({
  sources,
}: {
  sources: { available: SourceDescriptor[]; pending: SourceDescriptor[]; connected: ProviderReadiness[] };
}) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Connected providers</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">What Find Opportunities and Find people actually run on, with each provider&apos;s last test result.</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {sources.connected.length === 0 ? (
            <p className="text-2xs text-muted">No providers connected. Connect one in Settings → Providers.</p>
          ) : sources.connected.map((p) => (
            <p key={p.id} className="flex flex-wrap items-center gap-1.5 text-xs text-primary">
              {p.name}
              <Badge size="sm" uppercase variant={p.state === "healthy" ? "success" : p.state === "failing" ? "danger" : "neutral"}>
                {PROVIDER_STATE_LABEL[p.state]}
              </Badge>
            </p>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Search-phrase sources</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              What search phrases could fetch from. None of these is wired to a provider yet —
              opportunity discovery above uses the connected providers instead.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {sources.available.map((s) => (
            <div key={s.kind} className="rounded-md border border-success-border bg-success-subtle px-2.5 py-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-success-text">
                <Check className="size-3.5" />
                {s.label}
                <Badge variant="success" size="sm" uppercase>
                  Working
                </Badge>
              </p>
              <p className="mt-1 text-2xs leading-relaxed text-success-text/90">{s.value}</p>
              <p className="mt-1 text-2xs text-success-text/80">{s.compliance}</p>
            </div>
          ))}

          {sources.pending.map((s) => (
            <div key={s.kind} className="rounded-md border border-dashed border-border-strong bg-surface px-2.5 py-2">
              <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-primary">
                {s.label}
                <Badge variant="neutral" size="sm" uppercase>
                  Not connected
                </Badge>
              </p>
              <p className="mt-1 text-2xs leading-relaxed text-secondary">{s.value}</p>
              <p className="mt-1 text-2xs text-muted">
                <strong>Needs:</strong> {s.requires}
              </p>
              <Tooltip content="§32 — compliant sources only. No scraping of anything that forbids it.">
                <p className="mt-0.5 cursor-help text-2xs text-muted/80">{s.compliance}</p>
              </Tooltip>
            </div>
          ))}
        </CardContent>
        <CardFooter>
          <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted">
            <Target className="mt-0.5 size-3 shrink-0" />
            Search phrases, scheduling and per-phrase revenue attribution work today. Fetching for
            phrases is not built; save a watch on Find Opportunities to monitor for new demand.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
