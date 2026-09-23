import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/context";
import { getOpportunity, opportunityPeople } from "@/lib/services/opportunities";
import { MutationError } from "@/lib/services/mutate";
import { OpportunityActions } from "@/components/opportunities/actions";
import { BUYER_ATTRIBUTION_LABEL } from "@/lib/vocab";
export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth(); const { id } = await params;
  const o = await getOpportunity(ctx,id).catch(e => { if (e instanceof MutationError && e.status === 404) notFound(); throw e; });
  const people = await opportunityPeople(ctx,o.companyId);
  return <div className="mx-auto max-w-6xl space-y-6 p-6"><Link href="/opportunities" className="text-sm underline">All opportunities</Link><header><p className="text-secondary">{o.company.name} · {o.company.domain ?? "Domain unknown"}</p><h1 className="mt-1 text-3xl font-semibold">{o.title}</h1><p className="mt-2">{o.types.join(" · ").replaceAll("_", " ")}</p></header>
    <div className="grid gap-3 sm:grid-cols-4">{[["Intent", o.intentScore], ["Opportunity score", o.opportunityScore], ["Fit", o.fitScore], ["Status", o.status], ["Posted", o.postedAt?.slice(0,10) ?? "Unknown"], ["First discovered", o.discoveredAt.slice(0,10)], ["Last checked", o.lastCheckedAt.slice(0,10)], ["Last changed", o.lastChangedAt?.slice(0,10) ?? "No changes recorded"]].map(([label,value]) => <div key={label} className="rounded-xl border border-border bg-surface p-4"><p className="text-xs text-secondary">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div>
    <OpportunityActions id={id} /><section className="rounded-xl border border-border p-5"><h2 className="font-semibold">Why this matters</h2><p className="mt-2 whitespace-pre-wrap text-sm">{o.summary ?? (o.types.includes("INTERNAL_HIRING") ? "This company has an internal hiring requirement. The evidence does not by itself establish demand for an external service provider." : "This is a potential opportunity based on the source requirement. Review the evidence and current status before contacting anyone.")}</p></section>
    <section><h2 className="mb-3 text-lg font-semibold">Evidence and intent score</h2><div className="space-y-2">{o.evidence.map(e => <div key={e.id} className="rounded border border-border p-3"><p><span className="mr-3 font-semibold">{e.scoreContribution > 0 ? "+" : ""}{e.scoreContribution}</span>{e.description}</p><a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline">{e.source} · View original evidence</a><p className="text-xs text-secondary">Occurred: {e.occurredAt?.slice(0,10) ?? "Unknown"} · Discovered: {e.discoveredAt.slice(0,10)} · Confidence: {e.confidence}%</p></div>)}</div></section>
    <section><h2 className="text-lg font-semibold">Sources</h2>{o.sources.map(s => <article key={s.id} className="mt-3 rounded border border-border p-4"><a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{s.title} · {s.provider}</a><p className="mt-2 text-sm text-secondary">{s.description.slice(0,1800)}</p><BuyerAttributionNote reference={s.rawReference} /><p className="mt-2 text-xs">Source reference: {s.id} · Posted: {s.postedAt?.slice(0,10) ?? "Unknown"}</p></article>)}</section>
    <section><h2 className="text-lg font-semibold">Decision makers and contacts</h2>{!people.length && <p className="mt-2 text-sm text-secondary">No visible decision makers identified. Connect a licensed enrichment provider to search.</p>}{people.map(e => <div key={e.id} className="mt-3 rounded border border-border p-4"><p>{e.person.fullName} · {e.title}</p>{e.person.contactMethods.map(c => <p key={c.id} className="text-sm">{c.value} · {c.verificationResult === "VALID" && c.verifiedAt ? "Verified by provider" : c.verificationResult} · {c.source}</p>)}</div>)}</section>
    <section><h2 className="text-lg font-semibold">Technology mentions</h2><p className="text-sm">{o.technologies.join(", ") || "No supported technology evidence."}</p><p className="text-xs text-secondary">A mention in a requirement does not prove installed technology.</p></section>
    <section><h2 className="text-lg font-semibold">Timeline</h2><p className="mt-2 text-sm">{o.discoveredAt} — First discovered</p>{o.versions.map(v => <details key={v.id} className="mt-2"><summary>{v.changedAt} — Source changed</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(v.changedFields,null,2)}</pre></details>)}</section>
  </div>;
}

const isLinkedInUrl = (v: unknown): v is string => { try { const u = new URL(String(v)); return u.protocol === "https:" && (u.hostname === "linkedin.com" || u.hostname.endsWith(".linkedin.com")); } catch { return false; } };

function BuyerAttributionNote({ reference }: { reference: unknown }) {
  const r = (reference ?? {}) as { buyerAttribution?: { method?: string; quote?: string }; authorName?: string | null; authorHeadline?: string | null; authorProfileUrl?: string | null };
  const a = r.buyerAttribution;
  if (!r.authorName && !(a?.method && BUYER_ATTRIBUTION_LABEL[a.method])) return null;
  return <div className="mt-2 space-y-1 rounded border border-border-subtle bg-surface-sunken p-2 text-xs text-secondary">
    {r.authorName && <p>Posted by {isLinkedInUrl(r.authorProfileUrl) ? <a href={r.authorProfileUrl} target="_blank" rel="noopener noreferrer" className="underline">{r.authorName}</a> : r.authorName}{r.authorHeadline ? ` · ${r.authorHeadline}` : ""}</p>}
    {a?.method && BUYER_ATTRIBUTION_LABEL[a.method] && <p>{BUYER_ATTRIBUTION_LABEL[a.method]}</p>}
    {a?.quote && <blockquote className="italic">“{a.quote}”</blockquote>}
  </div>;
}
