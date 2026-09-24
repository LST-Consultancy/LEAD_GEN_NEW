import Link from "next/link";
import type { Funnel, StopReason } from "@/lib/opportunities/linkedin-run";
import { reconcile } from "@/lib/opportunities/linkedin-run";
import { explainRun } from "@/lib/opportunities/linkedin-explain";
import { DISCOVERY_REASON, DISCOVERY_STOP, QUERY_END } from "@/lib/vocab";

export type LinkedInResult = { status: string; found: number; message?: string; funnel?: Funnel; stop?: StopReason; stopDetail?: string; dateNote?: string | null; options?: { targetQualified: number; maxPosts: number; depth: string; edited: boolean } };

const Row = ({ label, value, indent = false, strong = false }: { label: string; value: number | string; indent?: boolean; strong?: boolean }) => (
  <div className={`flex justify-between gap-4 ${indent ? "pl-4 text-secondary" : ""} ${strong ? "font-medium" : ""}`}><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>
);
const reasonRows = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1]);

/**
 * One LinkedIn run as a funnel. Discovery (posts → unique → qualified / review / rejected) is kept
 * apart from CRM conversion, which only happens when a person converts an opportunity.
 */
export function LinkedInFunnel({ result, searchId, active, crmLeads }: { result: LinkedInResult; searchId: string; active: boolean; crmLeads: number }) {
  const f = result.funnel;
  if (!f) return null;
  const qualified = f.qualifiedNew + f.qualifiedKnown;
  const review = Object.values(f.review).reduce((a, b) => a + b, 0);
  const rejected = Object.values(f.rejected).reduce((a, b) => a + b, 0);
  const problems = reconcile(f);
  const explanations = !active && result.stop && result.options ? explainRun(f, result.stop, result.options) : [];
  return (
    <div className="space-y-3 rounded border border-border p-3 text-sm">
      {!active && result.stop && <p><span className="font-medium">Stopped:</span> {DISCOVERY_STOP[result.stop] ?? result.stop}{result.stopDetail ? ` — ${result.stopDetail}` : ""}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <dl className="min-w-0 space-y-1">
          <Row label="Queries run" value={`${f.queriesRun} of ${f.queriesPlanned}`} />
          <Row label="Pages completed" value={`${f.pagesCompleted} of ${f.pagesAttempted}${f.pagesFailed ? ` · ${f.pagesFailed} failed` : ""}`} />
          <Row label="Posts returned" value={f.returned} strong />
          <Row label="Repeats across queries and pages" value={f.duplicates} indent />
          <Row label="Unreadable records" value={f.unmappable} indent />
          <Row label="Unique posts" value={f.unique} strong />
          {f.usageUsd !== null && <Row label="Apify usage reported" value={`$${f.usageUsd.toFixed(2)}`} />}
        </dl>
        <dl className="min-w-0 space-y-1">
          <Row label="Qualified opportunities" value={qualified} strong />
          <Row label="New" value={f.qualifiedNew} indent />
          <Row label="Already known" value={f.qualifiedKnown} indent />
          <Row label="Needs review" value={review} strong />
          {reasonRows(f.review).map(([k, n]) => <Row key={k} label={DISCOVERY_REASON[k]?.label ?? k} value={n} indent />)}
          <Row label="Rejected" value={rejected} strong />
          {reasonRows(f.rejected).map(([k, n]) => <Row key={k} label={DISCOVERY_REASON[k]?.label ?? k} value={n} indent />)}
        </dl>
      </div>
      <p className="text-xs text-secondary">Each unique post is counted once, under its first failing rule. Returned = repeats + unreadable + unique; unique = qualified + needs review + rejected.{problems.length ? ` These counts do not reconcile (${problems.join("; ")}); please report it.` : ""}</p>
      <p className="border-t border-border pt-2"><span className="font-medium">Added to CRM:</span> <span className="tabular-nums">{crmLeads}</span> {crmLeads === 1 ? "lead" : "leads"} <span className="text-xs text-secondary">— a lead is created only when someone converts an opportunity and picks a contact. Discovery never creates leads or starts outreach.</span></p>
      {explanations.length > 0 && <ul className="list-disc space-y-1 pl-5 text-secondary">{explanations.map(e => <li key={e}>{e}</li>)}</ul>}
      {result.dateNote && <p className="text-xs text-secondary">{result.dateNote}</p>}
      {!active && (review > 0 || rejected > 0) && <div className="flex flex-wrap gap-4">
        {review > 0 && <Link className="font-medium underline" href={`/opportunities/review?searchId=${searchId}`}>Review {review} {review === 1 ? "post" : "posts"}</Link>}
        {rejected > 0 && <Link className="underline" href={`/opportunities/review?searchId=${searchId}&status=REJECTED`}>See {rejected} rejected and why</Link>}
      </div>}
      {f.perQuery.length > 0 && <details><summary className="cursor-pointer text-secondary">Per query</summary>
        <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-secondary">{["Query", "Pages", "Returned", "Unique", "Qualified", "Ended"].map(h => <th key={h} className="p-1 font-medium">{h}</th>)}</tr></thead>
          <tbody>{f.perQuery.map(q => <tr key={q.keyword} className="border-t border-border"><td className="max-w-xs p-1"><code className="break-words">{q.keyword}</code></td><td className="p-1 tabular-nums">{q.pages}</td><td className="p-1 tabular-nums">{q.returned}</td><td className="p-1 tabular-nums">{q.unique}</td><td className="p-1 tabular-nums">{q.qualified}</td><td className="p-1">{q.end ? QUERY_END[q.end] ?? q.end : active ? "running" : "not run"}</td></tr>)}</tbody></table></div>
      </details>}
    </div>
  );
}
