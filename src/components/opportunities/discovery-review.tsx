"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DISCOVERY_REASON } from "@/lib/vocab";
import type { discoveryReasonCounts, listDiscoveryCandidates } from "@/lib/services/discovery-review";
import type { FilterCheck } from "@/lib/opportunities/linkedin-qualify";
type Match = Awaited<ReturnType<typeof listDiscoveryCandidates>>[number];
type Counts = Awaited<ReturnType<typeof discoveryReasonCounts>>;
type Filter = { searchId?: string; status: "REVIEW" | "REJECTED"; reason?: string };
type Evidence = { quote?: string | null; matchedTerms?: string[]; filters?: FilterCheck[]; query?: string | null; detail?: string; suggestedFrom?: string | null; reviewReasons?: string[] };

const CLASSIFICATION: Record<string, string> = { buying: "Buying request", seller_promotion: "Seller promotion", job_seeker: "Job seeker", internal_hiring: "Employee vacancy", informational: "Informational" };
const href = (f: Filter) => `/opportunities/review?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString()}`;

function EvidenceBlock({ item }: { item: Match }) {
  const e = (item.evidence ?? {}) as Evidence;
  const reason = item.reason ? DISCOVERY_REASON[item.reason] : null;
  return <div className="space-y-1 text-xs">
    {reason && <p><span className="font-medium">{reason.label}.</span> <span className="text-secondary">{reason.explain}</span>{e.detail ? <span className="text-secondary"> {e.detail}</span> : null}</p>}
    {(e.reviewReasons?.length ?? 0) > 1 && <p className="text-secondary">Also: {e.reviewReasons!.slice(1).map(r => DISCOVERY_REASON[r]?.label.toLowerCase() ?? r).join(", ")}.</p>}
    {item.classification && <p className="text-secondary">Read as: {CLASSIFICATION[item.classification] ?? item.classification}{e.matchedTerms?.length ? ` · mentions ${e.matchedTerms.join(", ")}` : ""}</p>}
    {e.quote && <blockquote className="border-l-2 border-border pl-2 text-secondary">{e.quote}</blockquote>}
    {e.filters && e.filters.length > 0 && <ul className="flex flex-wrap gap-2">{e.filters.map(f => <li key={f.field} className="rounded border border-border px-2 py-0.5">{f.field}: {f.state === "unknown" ? "unknown" : `${f.value} (${f.state === "match" ? "matches" : "does not match"} ${f.wanted})`}</li>)}</ul>}
    {e.query && <p className="text-secondary">Found by: <code className="break-words">{e.query}</code></p>}
  </div>;
}

function MatchCard({ item, canEdit }: { item: Match; canEdit: boolean }) {
  const router = useRouter(); const e = (item.evidence ?? {}) as Evidence;
  const [company, setCompany] = useState(item.suggestedBuyer ?? ""); const [domain, setDomain] = useState(""); const [country, setCountry] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState(false);
  async function review(action: string) { setBusy(true); try { const result = await api.post<{ opportunityId: string | null }>(`/api/discovery-candidates/${item.id}`, { action, company, domain: domain || undefined, country: country || undefined }); if (result.opportunityId) router.push(`/opportunities/${result.opportunityId}`); else router.refresh(); } catch (err) { setMessage(err instanceof Error ? err.message : "Review failed."); } finally { setBusy(false); } }
  const rejected = item.status === "REJECTED";
  const form = canEdit && (!rejected || override);
  return <article className="min-w-0 space-y-3 rounded-xl border border-border bg-surface p-5">
    <p className="text-xs text-secondary">{item.kind === "LINKEDIN_PUBLIC_POST" ? "Public LinkedIn post" : "Web search match"} · {rejected ? "Rejected" : item.processing === "RETRY_PENDING" ? "Buyer check pending" : "Needs review"} · {item.postedAt ? `Posted ${item.postedAt.slice(0, 10)}` : "Posting date unknown"}</p>
    <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="block break-words font-semibold underline">{item.title}</a>
    <p className="line-clamp-6 whitespace-pre-line break-words text-sm text-secondary">{item.description}</p>
    <EvidenceBlock item={item} />
    {canEdit && rejected && !override && <button type="button" className="text-sm underline" onClick={() => setOverride(true)}>This is a real buying request — qualify it anyway</button>}
    {form && <form onSubmit={ev => { ev.preventDefault(); void review("qualify"); }} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3"><label className="min-w-0 text-sm">Buying company<Input value={company} onChange={ev => setCompany(ev.target.value)} required minLength={2} /></label><label className="min-w-0 text-sm">Confirmed domain (optional)<Input value={domain} onChange={ev => setDomain(ev.target.value)} placeholder="company.com" /></label><label className="min-w-0 text-sm">Country (if confirmed)<Input value={country} onChange={ev => setCountry(ev.target.value)} /></label></div>
      <p className="text-xs text-secondary">{item.suggestedBuyer ? `“${item.suggestedBuyer}” is a suggestion ${e.suggestedFrom === "author_headline" ? "read from the author's headline" : "named in the post"}; confirm it from the post before qualifying. ` : ""}A publisher, recruiter or post author may not be the buyer. Details you leave blank stay recorded as unknown; a value that conflicts with the search&apos;s filters is refused.</p>
      <div className="flex gap-2"><Button disabled={busy}>Qualify opportunity</Button>{!rejected && <Button type="button" variant="outline" disabled={busy} onClick={() => review("dismiss")}>Dismiss</Button>}</div></form>}
    {message && <p role="alert" className="text-sm text-danger-text">{message}</p>}
  </article>;
}

export function DiscoveryReview({ items, counts, filter, canEdit }: { items: Match[]; counts: Counts; filter: Filter; canEdit: boolean }) {
  const total = (status: string) => counts.filter(c => c.status === status).reduce((n, c) => n + c.count, 0);
  const reasons = counts.filter(c => c.status === filter.status && c.reason).sort((a, b) => b.count - a.count);
  const tab = (status: Filter["status"], label: string) => <Link href={href({ searchId: filter.searchId, status })} aria-current={filter.status === status ? "page" : undefined} className={`rounded px-3 py-1 text-sm ${filter.status === status ? "bg-surface-sunken font-medium" : "text-secondary"}`}>{label} <span className="tabular-nums">({total(status)})</span></Link>;
  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">Discovery review</h1>
    <p className="text-secondary">{filter.status === "REVIEW" ? "Relevant posts and pages that a person has to confirm: the buyer is not named, or a detail the search filters on is unknown. These are research candidates, not verified leads." : "Posts the rules set aside, each with the one rule that did it. If one is a real buying request, you can qualify it anyway."} Showing up to 100{filter.searchId ? " from this search" : ""}.</p>
    <nav className="flex flex-wrap gap-2" aria-label="Review status">{tab("REVIEW", "Needs review")}{tab("REJECTED", "Rejected")}</nav>
    {reasons.length > 0 && <div className="flex flex-wrap gap-2 text-xs" aria-label="Filter by reason">
      <Link href={href({ ...filter, reason: undefined })} className={`rounded border border-border px-2 py-1 ${!filter.reason ? "font-medium" : "text-secondary"}`}>All</Link>
      {reasons.map(r => <Link key={r.reason} href={href({ ...filter, reason: r.reason! })} className={`rounded border border-border px-2 py-1 ${filter.reason === r.reason ? "font-medium" : "text-secondary"}`}>{DISCOVERY_REASON[r.reason!]?.label ?? r.reason} <span className="tabular-nums">{r.count}</span></Link>)}
    </div>}
    <div className="flex gap-4 text-sm">{filter.searchId && <Link href={href({ status: filter.status })} className="underline">All searches</Link>}<Link href="/find-leads" className="underline">Find more opportunities</Link></div>
    {items.length ? items.map(item => <MatchCard key={item.id} item={item} canEdit={canEdit} />)
      : <p className="rounded-xl border border-border p-6">{filter.status === "REVIEW" ? "Nothing is waiting for review. Posts land here when they read as a buying request but the buyer is not named or the company's details are unknown. Run a LinkedIn or web search to collect some." : "No rejected posts are held. Rejected posts are kept for the source's retention period so their reasons can be checked."}</p>}
  </div>;
}
