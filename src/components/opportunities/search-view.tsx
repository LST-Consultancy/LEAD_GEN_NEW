"use client";
import { DISCOVERY_PROVIDERS } from "@/lib/providers/opportunity-source";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { parseOpportunityQuery, type SearchCriteria } from "@/lib/opportunities/query-parser";
import { webQueryTerms } from "@/lib/opportunities/web-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DISCOVERY_STATE, PROVIDER_RESULT_LABEL, SCREEN_REASON_LABEL } from "@/lib/vocab";
import { OpportunityTable } from "./table";
import { LinkedInOptions } from "./linkedin-options";
import { LinkedInFunnel, type LinkedInResult } from "./linkedin-funnel";
import { discoveryOptionsSchema, type DiscoveryOptions } from "@/lib/opportunities/linkedin-plan";
import type { listOpportunities, getOpportunitySearch } from "@/lib/services/opportunities";
import type { listOpportunityProviders } from "@/lib/services/opportunity-providers";

type Results = Awaited<ReturnType<typeof listOpportunities>>;
type Search = Awaited<ReturnType<typeof getOpportunitySearch>>;
export function OpportunitySearchView({ providers }: { providers: Awaited<ReturnType<typeof listOpportunityProviders>> }) {
  const [cadenceHours, setCadenceHours] = useState(24);
  const [query, setQuery] = useState(""); const [selected, setSelected] = useState<string[]>(providers.filter(p => (DISCOVERY_PROVIDERS as readonly string[]).includes(p.id) && p.connection?.enabled && p.connection.allowedSearch && p.connection.allowedStorage).map(p => p.id));
  const [job, setJob] = useState<Search | null>(null); const [results, setResults] = useState<Results | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [note, setNote] = useState("");
  const [interpreted, setInterpreted] = useState<SearchCriteria | null>(null);
  const [options, setOptions] = useState<DiscoveryOptions>(() => discoveryOptionsSchema.parse({}));
  const [days, setDays] = useState<number | null>(null);
  const parsed = interpreted ?? (query.trim().length >= 3 ? parseOpportunityQuery(query) : null);
  // The date range control overrides what the parser read from the wording ("last 90 days").
  const criteria = parsed && days ? { ...parsed, dateRange: { days } } : parsed;
  const linkedIn = providers.find(p => p.id === "linkedin_posts");
  const linkedInSelected = selected.includes("linkedin_posts");
  const workspaceMaxPosts = (linkedIn?.connection?.config as { maxPostsPerSearch?: number } | null)?.maxPostsPerSearch ?? 500;
  const queryPreviews = criteria ? providers.filter(p => p.id === "brave" && selected.includes(p.id))
    .map(p => ({ name: p.name, terms: webQueryTerms(criteria, (p.connection?.config as { maxQueries?: number } | null)?.maxQueries ?? 3) })) : [];
  useEffect(() => {
    if (!job || !["QUEUED", "RUNNING"].includes(job.state)) return;
    const timer = setInterval(async () => { try { const next = await api.get<Search>(`/api/opportunities/search/${job.id}`); setJob(next); if (!["QUEUED", "RUNNING"].includes(next.state)) setResults(await api.get<Results>(`/api/opportunities?searchId=${job.id}`)); } catch (e) { setError(e instanceof Error ? e.message : "Search status unavailable."); } }, 2500);
    return () => clearInterval(timer);
  }, [job]);
  const refresh = async (id: string) => { const next = await api.get<Search>(`/api/opportunities/search/${id}`); setJob(next); if (!["QUEUED", "RUNNING"].includes(next.state)) setResults(await api.get<Results>(`/api/opportunities?searchId=${id}`)); };
  async function control(action: "cancel" | "resume" | "retry-attribution") {
    if (!job) return; setBusy(true); setError("");
    try { const r = await api.post<{ note?: string; attempted?: number; remaining?: number }>(`/api/opportunities/search/${job.id}/${action}`, {}); if (r.note) setNote(r.note); else if (action === "retry-attribution") setNote(`Retried the buyer check for ${r.attempted ?? 0} ${r.attempted === 1 ? "post" : "posts"}.${r.remaining ? ` ${r.remaining} still waiting.` : ""}`); await refresh(job.id); }
    catch (e) { setError(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); }
  }
  async function start() { setBusy(true); setError(""); setNote(""); setResults(null); try { setJob(await api.post<Search>("/api/opportunities/search", { query, criteria, providers: selected, ...(linkedInSelected ? { options } : {}), idempotencyKey: crypto.randomUUID() })); } catch (e) { setError(e instanceof Error ? e.message : "Search failed."); } finally { setBusy(false); } }
  async function analyze() { setBusy(true); try { const r = await api.post<{criteria: SearchCriteria; note: string}>("/api/opportunities/parse",{query}); setInterpreted(r.criteria); setNote(r.note); } catch(e) { setError(e instanceof Error ? e.message : "Analysis failed."); } finally { setBusy(false); } }
  async function save() { try { await api.post("/api/opportunity-searches", { name: query.slice(0,80), query, criteria, providers: selected, cadenceHours, ...(linkedInSelected ? { options } : {}) }); setNote("Saved as a scheduled watch. In-app notifications appear when the worker finds matches."); } catch (e) { setError(e instanceof Error ? e.message : "Could not save watch."); } }
  return <section className="space-y-5 rounded-xl border border-border bg-surface p-6">
    <div><p className="text-sm text-secondary">Evidence-led discovery</p><h1 className="text-2xl font-semibold">Find Opportunities</h1><p className="mt-2 text-secondary">What are you looking for? Describe a service, technology, project or hiring requirement.</p></div>
    <form onSubmit={e => { e.preventDefault(); void start(); }} className="space-y-4"><label className="block text-sm">Service or requirement<Input maxLength={2000} value={query} onChange={e => {setQuery(e.target.value); setInterpreted(null);}} placeholder="NetSuite implementation and integration opportunities in US companies" className="mt-2" /></label>
    <fieldset className="flex flex-wrap gap-4"><legend className="mb-2 text-sm">Sources</legend>{providers.filter(p => (DISCOVERY_PROVIDERS as readonly string[]).includes(p.id)).map(p => <label key={p.id} className="text-sm"><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} /> {p.name} <span className="text-secondary">{p.connection?.status ?? "Not connected"}</span></label>)}</fieldset>
    {criteria && <details open><summary className="text-sm">Search expansion · last {criteria.dateRange.days} days</summary><div className="mt-2 flex flex-wrap gap-2">{criteria.expandedTerms.map(t => <span key={t} className="rounded border border-border px-2 py-1 text-xs">{t}</span>)}</div><p className="mt-2 text-xs text-secondary">{interpreted ? "AI-assisted query parser." : "Deterministic query parser."} Unknown company size, location or industry never counts as a match: LinkedIn posts with unknown details are kept for review (or rejected under strict filters); other sources exclude them.</p>
      {queryPreviews.filter(q => q.terms.length).map(q => <p key={q.name} className="mt-2 text-xs text-secondary">{q.name} will search: {q.terms.join(" · ")}</p>)}</details>}
    {criteria && linkedInSelected && <LinkedInOptions criteria={criteria} query={query} options={options} onOptions={setOptions} days={criteria.dateRange.days} onDays={setDays} workspaceMaxPosts={workspaceMaxPosts} />}
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || !criteria || !selected.length || !!job && ["QUEUED", "RUNNING"].includes(job.state)}>Find Opportunities</Button><Button type="button" variant="outline" disabled={!criteria || busy} onClick={analyze}>Analyze with AI</Button><Button type="button" variant="outline" disabled={!criteria || !selected.length} onClick={save}>Save watch</Button><select aria-label="Watch frequency" value={cadenceHours} onChange={e => setCadenceHours(Number(e.target.value))} className="rounded border border-border bg-surface px-2"><option value={6}>Every 6 hours</option><option value={24}>Daily</option><option value={72}>Every 3 days</option><option value={168}>Weekly</option></select><Link className="self-center text-sm underline" href="/settings/providers">Configure sources</Link><Link className="self-center text-sm underline" href="/opportunities">All opportunities</Link></div></form>
    {error && <p role="alert" className="text-danger-text">{error}</p>}{note && <p role="status">{note}</p>}
    {job && <SearchStatus job={job} busy={busy} onControl={control} providerName={id => providers.find(p => p.id === id)?.name ?? id} />}
    {results && results.total > 0 && <OpportunityTable data={results} newSince={job?.startedAt ?? null} />}
    <p className="text-xs text-secondary">Hiring is an internal requirement unless the evidence also requests an external provider. Discovery never starts outreach.</p>
  </section>;
}

type ProviderOutcome = LinkedInResult & { screened?: Record<string, number> };
const SCREEN_ORDER = ["seller_or_publisher", "not_a_request", "hiring_only", "no_named_buyer", "not_relevant", "ai_unavailable"];
function screenedLine(screened: Record<string, number> | undefined) {
  const parts = SCREEN_ORDER.filter(k => screened?.[k]).map(k => `${screened![k]} ${SCREEN_REASON_LABEL[k]}`);
  return parts.length ? `Set aside: ${parts.join(" · ")}` : null;
}
function SearchStatus({ job, providerName, busy, onControl }: { job: Search; providerName: (id: string) => string; busy: boolean; onControl: (action: "cancel" | "resume" | "retry-attribution") => void }) {
  const active = job.state === "QUEUED" || job.state === "RUNNING";
  const state = DISCOVERY_STATE[job.state] ?? { label: job.state, variant: "neutral" as const };
  const outcomes = Object.entries((job.providerResults ?? {}) as Record<string, ProviderOutcome>);
  const finishedClean = job.state === "COMPLETED" || job.state === "PARTIAL";
  // Older payloads (and a search from before these fields existed) may lack them.
  const retries = job.retries ?? []; const retryPending = job.retryPending ?? 0; const crmLeads = job.crmLeads ?? 0;
  const aiSkipped = outcomes.reduce((n, [, o]) => n + (o.screened?.ai_unavailable ?? 0), 0);
  return <div aria-live="polite" className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant={state.variant} size="lg">{state.label}</Badge>
      <span className="tabular-nums text-secondary">{active ? `${job.progress}% · ` : ""}{job.found} found · {job.qualified} qualified{job.needsReview ? ` · ${job.needsReview} need review` : ""}</span></div>
    {active && <progress className="w-full" value={job.progress} max={100} aria-label="Search progress" />}
    <div className="flex flex-wrap gap-2">
      {active && <Button type="button" variant="outline" size="sm" disabled={busy || Boolean(job.cancelRequestedAt)} onClick={() => onControl("cancel")}>{job.cancelRequestedAt ? "Stopping after this page…" : "Cancel search"}</Button>}
      {!active && job.resumable && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onControl("resume")}>Resume from where it stopped</Button>}
      {!active && retryPending > 0 && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onControl("retry-attribution")}>Retry buyer check ({Math.min(20, retryPending)} of {retryPending})</Button>}
    </div>
    {!active && job.resumable && <p className="text-xs text-secondary">Resuming continues from the saved checkpoint: finished pages are not fetched or charged again.</p>}
    {job.notice && <p role="status" className="rounded border border-warning-border bg-warning-subtle p-3 text-sm text-warning-text">{job.notice}</p>}
    {job.error && <p role="alert" className="rounded border border-danger-border bg-danger-subtle p-3 text-sm text-danger-text">{job.error}</p>}
    {outcomes.length > 0 && <ul className="space-y-2 text-sm">{outcomes.map(([id, o]) => <li key={id} className="min-w-0"><span className="font-medium">{providerName(id)}</span> <span className="text-secondary">· {PROVIDER_RESULT_LABEL[o.status] ?? o.status} · <span className="tabular-nums">{o.found}</span> {o.funnel ? (o.found === 1 ? "unique post" : "unique posts") : o.found === 1 ? "result" : "results"}</span>{screenedLine(o.screened) && <span className="block text-xs text-secondary tabular-nums">{screenedLine(o.screened)}</span>}{o.message && <span className="block text-xs text-secondary">{o.message}</span>}{o.funnel && <div className="mt-2"><LinkedInFunnel result={o} searchId={job.id} active={active} crmLeads={crmLeads} /></div>}</li>)}</ul>}
    {retries.length > 0 && <p className="text-xs text-secondary">After the run, the buyer check was retried {retries.length} {retries.length === 1 ? "time" : "times"} for <span className="tabular-nums">{retries.reduce((n, r) => n + r.attempted, 0)}</span> posts; those results are in the review list and table, not in the funnel above.</p>}
    {aiSkipped > 0 && <p role="status" className="rounded border border-warning-border bg-warning-subtle p-3 text-sm text-warning-text">The AI buyer check could not run, so {aiSkipped} {aiSkipped === 1 ? "result that might name a buyer was" : "results that might name a buyer were"} not checked and not kept. Check Settings → AI Assistant, then search again.</p>}
    {!active && job.needsReview > 0 && <div className="rounded border border-border bg-surface-sunken p-3 text-sm">
      <p><span className="tabular-nums">{job.needsReview}</span> {job.needsReview === 1 ? "result needs" : "results need"} a buyer before {job.needsReview === 1 ? "it" : "they"} can qualify. Web and LinkedIn pages don&apos;t say which company is asking, so a person has to confirm it.</p>
      <Link href={`/opportunities/review?searchId=${job.id}`} className="mt-2 inline-block font-medium underline">Review {job.needsReview} {job.needsReview === 1 ? "result" : "results"}</Link></div>}
    {finishedClean && job.qualified === 0 && job.needsReview === 0 && <p className="text-sm text-secondary">{job.found === 0
      ? "The selected sources returned nothing for this search. Try broader wording or connect another source."
      : `None of the ${job.found} results described a project that matches this search. Buyers tend to write "looking for a partner" or "RFP for", so try wording the search that way.`}</p>}
  </div>;
}
