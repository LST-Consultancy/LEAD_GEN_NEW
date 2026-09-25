"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { classifyTarget } from "@/lib/enrichment/lookup";
import type { leadLensReadiness } from "@/lib/services/lead-lens";

type Readiness = Awaited<ReturnType<typeof leadLensReadiness>>;
type Lookup = Readiness["recent"][number] & { person?: { id: string; fullName: string; headline: string | null; employments: { title: string; company: { id: string; name: string } }[] } | null; company?: { id: string; name: string; domain: string | null; industry: string | null; city: string | null; country: string; employeeCount: number | null } | null; cached?: boolean };
const STATUS: Record<string, { label: string; variant: "success" | "neutral" | "warning" | "danger" | "info" }> = { FOUND: { label: "Found", variant: "success" }, NO_MATCH: { label: "No match", variant: "neutral" }, NEEDS_CONFIRMATION: { label: "Needs your choice", variant: "warning" }, NOT_CONNECTED: { label: "Not connected", variant: "warning" }, FAILED: { label: "Failed", variant: "danger" }, RUNNING: { label: "Running", variant: "info" } };

/** Looks a profile, company page or domain up outside the workspace, explicitly and at a stated cost. */
export function ExternalLookup({ query, readiness }: { query: string; readiness: Readiness }) {
  const [result, setResult] = useState<Lookup | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const t = classifyTarget(query);
  if (t.kind === "unsupported") return <p className="text-2xs text-secondary">{t.reason}</p>;
  const person = t.kind === "person_linkedin";
  const ready = person ? readiness.personProviders.length > 0 && readiness.canReveal : readiness.companyReady && readiness.canEdit;
  const cost = person ? `Uses ${readiness.personProviders.join(" then ") || "SignalHire or Apollo"}: one provider credit per successful match.` : `Uses your Apify account: ${t.kind === "domain" ? "a Google search plus up to three LinkedIn company pages" : "one LinkedIn company page"}, a few cents at listed prices.`;
  async function go(refresh = false) {
    setBusy(true); setMessage("");
    try { setResult(await api.post<Lookup>("/api/lookup/external", { target: query, refresh })); } catch (e) { setMessage(e instanceof Error ? e.message : "The lookup failed."); } finally { setBusy(false); }
  }
  async function confirm(index: number) {
    if (!result) return; setBusy(true);
    try { setResult(await api.post<Lookup>(`/api/lookup/external/${result.id}/confirm`, { index })); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save that."); } finally { setBusy(false); }
  }
  const candidates = (result?.candidates ?? []) as { fullName?: string; name?: string; title?: string | null; headline?: string | null; domain?: string | null; linkedinUrl?: string | null; employer?: { name: string } | null; city?: string | null }[];
  return <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
    <p className="font-medium text-primary">Look up outside this workspace</p>
    <p className="text-secondary">{cost} A found answer is kept for 30 days and shown again without charging. Nothing is sent to the person.</p>
    {!ready && <p className="text-warning-text">{person ? (readiness.canReveal ? readiness.personWhy : "Your role cannot reveal contact details.") : readiness.canEdit ? "Save an Apify token on Apify enrichment or LinkedIn posts first." : "Your role cannot add companies."} <Link href="/settings/providers" className="underline">Lead Sources & APIs</Link></p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!ready || busy} loading={busy} onClick={() => void go()}>Look up {person ? "this profile" : "this company"}</Button>
      {result?.cached && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void go(true)}>Look up again (charges again)</Button>}</div>
    {message && <p role="alert" className="text-danger-text">{message}</p>}
    {result && <div className="space-y-1 rounded border border-border p-2">
      <p><Badge variant={STATUS[result.status]?.variant ?? "neutral"} size="sm">{STATUS[result.status]?.label ?? result.status}</Badge>{result.cached ? <span className="ml-2 text-secondary">from a lookup on {result.createdAt.slice(0, 10)} — not charged again</span> : null}{result.provider ? <span className="ml-2 text-secondary">via {result.provider}</span> : null}</p>
      {result.note && <p className="text-secondary">{result.note}</p>}
      {result.person && <p><Link href={`/people-finder?q=${encodeURIComponent(result.person.fullName)}`} className="font-medium underline">{result.person.fullName}</Link>{result.person.employments[0] ? ` · ${result.person.employments[0].title || "title unknown"} at ${result.person.employments[0].company.name}` : ""}</p>}
      {result.company && <p><Link href={`/accounts/${result.company.id}`} className="font-medium underline">{result.company.name}</Link>{[result.company.domain, result.company.industry, result.company.city, result.company.employeeCount ? `${result.company.employeeCount} employees` : null].filter(Boolean).map(x => ` · ${x}`).join("")}</p>}
      {result.status === "NEEDS_CONFIRMATION" && <ul className="space-y-1">{candidates.map((c, i) => <li key={i} className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-words">{c.fullName ?? c.name}{c.title ? ` · ${c.title}` : ""}{c.employer ? ` at ${c.employer.name}` : ""}{c.domain ? ` · ${c.domain}` : ""}{c.city ? ` · ${c.city}` : ""}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => void confirm(i)}>This one</Button></li>)}</ul>}
    </div>}
  </div>;
}

export function RecentLookups({ recent }: { recent: Readiness["recent"] }) {
  if (!recent.length) return null;
  return <div className="rounded-lg border border-border p-3 text-xs"><p className="font-medium text-primary">Recent external lookups</p>
    <ul className="mt-1 space-y-0.5 text-secondary">{recent.map(r => <li key={r.id} className="min-w-0 break-words">{r.createdAt.slice(0, 10)} · {r.target} · {STATUS[r.status]?.label ?? r.status}{r.provider ? ` via ${r.provider}` : ""}</li>)}</ul></div>;
}
