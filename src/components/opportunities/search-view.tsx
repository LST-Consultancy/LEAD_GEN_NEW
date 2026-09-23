"use client";
import { DISCOVERY_PROVIDERS } from "@/lib/providers/opportunity-source";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { parseOpportunityQuery, type SearchCriteria } from "@/lib/opportunities/query-parser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OpportunityTable } from "./table";
import type { listOpportunities, getOpportunitySearch } from "@/lib/services/opportunities";
import type { listOpportunityProviders } from "@/lib/services/opportunity-providers";

type Results = Awaited<ReturnType<typeof listOpportunities>>;
type Search = Awaited<ReturnType<typeof getOpportunitySearch>>;
export function OpportunitySearchView({ providers }: { providers: Awaited<ReturnType<typeof listOpportunityProviders>> }) {
  const [cadenceHours, setCadenceHours] = useState(24);
  const [query, setQuery] = useState(""); const [selected, setSelected] = useState<string[]>(providers.filter(p => (DISCOVERY_PROVIDERS as readonly string[]).includes(p.id) && p.connection?.enabled && p.connection.allowedSearch && p.connection.allowedStorage).map(p => p.id));
  const [job, setJob] = useState<Search | null>(null); const [results, setResults] = useState<Results | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [note, setNote] = useState("");
  const [interpreted, setInterpreted] = useState<SearchCriteria | null>(null);
  const criteria = interpreted ?? (query.trim().length >= 3 ? parseOpportunityQuery(query) : null);
  useEffect(() => {
    if (!job || !["QUEUED", "RUNNING"].includes(job.state)) return;
    const timer = setInterval(async () => { try { const next = await api.get<Search>(`/api/opportunities/search/${job.id}`); setJob(next); if (!["QUEUED", "RUNNING"].includes(next.state)) setResults(await api.get<Results>(`/api/opportunities?searchId=${job.id}`)); } catch (e) { setError(e instanceof Error ? e.message : "Search status unavailable."); } }, 2500);
    return () => clearInterval(timer);
  }, [job]);
  async function start() { setBusy(true); setError(""); setResults(null); try { setJob(await api.post<Search>("/api/opportunities/search", { query, criteria, providers: selected, idempotencyKey: crypto.randomUUID() })); } catch (e) { setError(e instanceof Error ? e.message : "Search failed."); } finally { setBusy(false); } }
  async function analyze() { setBusy(true); try { const r = await api.post<{criteria: SearchCriteria; note: string}>("/api/opportunities/parse",{query}); setInterpreted(r.criteria); setNote(r.note); } catch(e) { setError(e instanceof Error ? e.message : "Analysis failed."); } finally { setBusy(false); } }
  async function save() { try { await api.post("/api/opportunity-searches", { name: query.slice(0,80), query, criteria, providers: selected, cadenceHours }); setNote("Saved as a scheduled watch. In-app notifications appear when the worker finds matches."); } catch (e) { setError(e instanceof Error ? e.message : "Could not save watch."); } }
  return <section className="space-y-5 rounded-xl border border-border bg-surface p-6">
    <div><p className="text-sm text-secondary">Evidence-led discovery</p><h1 className="text-2xl font-semibold">Find Opportunities</h1><p className="mt-2 text-secondary">What are you looking for? Describe a service, technology, project or hiring requirement.</p></div>
    <form onSubmit={e => { e.preventDefault(); void start(); }} className="space-y-4"><label className="block text-sm">Service or requirement<Input maxLength={2000} value={query} onChange={e => {setQuery(e.target.value); setInterpreted(null);}} placeholder="NetSuite implementation and integration opportunities in US companies" className="mt-2" /></label>
    <fieldset className="flex flex-wrap gap-4"><legend className="mb-2 text-sm">Sources</legend>{providers.filter(p => (DISCOVERY_PROVIDERS as readonly string[]).includes(p.id)).map(p => <label key={p.id} className="text-sm"><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} /> {p.name} <span className="text-secondary">{p.connection?.status ?? "Not connected"}</span></label>)}</fieldset>
    {criteria && <details open><summary className="text-sm">Search expansion · last {criteria.dateRange.days} days</summary><div className="mt-2 flex flex-wrap gap-2">{criteria.expandedTerms.map(t => <span key={t} className="rounded border border-border px-2 py-1 text-xs">{t}</span>)}</div><p className="mt-2 text-xs text-secondary">{interpreted ? "AI-assisted query parser." : "Deterministic query parser."} Unavailable company size or location data cannot satisfy an explicit filter.</p></details>}
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || !criteria || !selected.length || !!job && ["QUEUED", "RUNNING"].includes(job.state)}>Find Opportunities</Button><Button type="button" variant="outline" disabled={!criteria || busy} onClick={analyze}>Analyze with AI</Button><Button type="button" variant="outline" disabled={!criteria || !selected.length} onClick={save}>Save watch</Button><select aria-label="Watch frequency" value={cadenceHours} onChange={e => setCadenceHours(Number(e.target.value))} className="rounded border border-border bg-surface px-2"><option value={6}>Every 6 hours</option><option value={24}>Daily</option><option value={72}>Every 3 days</option><option value={168}>Weekly</option></select><Link className="self-center text-sm underline" href="/settings/providers">Configure sources</Link><Link className="self-center text-sm underline" href="/opportunities">All opportunities</Link></div></form>
    {error && <p role="alert" className="text-danger-text">{error}</p>}{note && <p role="status">{note}</p>}
    {job && <div aria-live="polite" className="space-y-2"><p>{job.state} · {job.progress}% · {job.qualified} qualified</p><progress className="w-full" value={job.progress} max={100} aria-label="Search progress" /><pre className="overflow-auto whitespace-pre-wrap text-xs text-secondary">{JSON.stringify(job.providerResults, null, 2)}</pre>{job.error && <p role="alert">{job.error}</p>}</div>}
    {results && <><OpportunityTable data={results} /><Link href={`/opportunities/review?searchId=${job?.id}`} className="inline-block text-sm underline">Review web & LinkedIn matches with unresolved buyers</Link></>}
    <p className="text-xs text-secondary">Hiring is an internal requirement unless the evidence also requests an external provider. Discovery never starts outreach.</p>
  </section>;
}
