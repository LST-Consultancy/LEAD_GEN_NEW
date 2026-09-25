"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RUN_STATE_LABEL, STAGE_LABEL, TERMINAL, type RunKind, type RunState, type Stage } from "@/lib/enrichment/stages";
import { CHECK_LABEL } from "@/lib/enrichment/verification";
import { FALLBACK_LABEL, FALLBACK_PROVIDERS } from "@/lib/enrichment/fallback";
import { money } from "@/lib/enrichment/config";
import type { getEnrichmentRun, getOpportunityEnrichment } from "@/lib/services/enrichment";

type Snapshot = Awaited<ReturnType<typeof getOpportunityEnrichment>>;
type RunView = Awaited<ReturnType<typeof getEnrichmentRun>>;
type Person = Snapshot["people"][number];
type Candidate = { profile: { name: string; linkedinUrl: string; domain: string | null; city: string | null; country: string | null; industry: string | null; employeeCount: number | null; description: string | null }; score: number; reasons: string[]; conflicts: string[] };

const ACTIONS: { kind: RunKind; label: string; hint: string }[] = [
  { kind: "research", label: "Research company", hint: "Resolve the company's website and LinkedIn page, then save its profile." },
  { kind: "people", label: "Find people", hint: "Find relevant people at the company; they are saved with or without an email." },
  { kind: "emails", label: "Find emails", hint: "Collect business emails from the sources, the company website and the employee search." },
  { kind: "verify", label: "Check emails", hint: "Check addresses already found. Separate from finding them." },
];
const ASSOCIATION: Record<string, string> = { current: "Current employee", former: "Former employee", uncertain: "Association uncertain" };
const n = (v: unknown) => (typeof v === "number" ? v : 0);

/** One sentence of counts per stage, from what the worker recorded — never a fixed message. */
function stageCounts(s: Stage): string | null {
  const c = s.counts ?? {};
  switch (s.key) {
    case "resolve": return c.candidatesChecked !== undefined ? `${n(c.candidatesChecked)} ${n(c.candidatesChecked) === 1 ? "candidate" : "candidates"} checked${c.confidence ? ` · confidence ${n(c.confidence)}/100` : ""}` : null;
    case "details": return c.fieldsUpdated !== undefined ? `${n(c.fieldsUpdated)} ${n(c.fieldsUpdated) === 1 ? "field" : "fields"} updated${n(c.fieldsKept) ? ` · ${n(c.fieldsKept)} kept as they were` : ""}` : null;
    case "people": return c.saved !== undefined ? `${n(c.saved)} new · ${n(c.updated)} updated · ${n(c.current)} current, ${n(c.uncertain)} uncertain, ${n(c.former)} former${n(c.withoutTitle) ? ` · ${n(c.withoutTitle)} without a title` : ""}${n(c.suppressed) ? ` · ${n(c.suppressed)} suppressed` : ""}` : null;
    case "emails": return c.personal !== undefined ? `${n(c.personal)} personal${n(c.inferred) ? ` · ${n(c.inferred)} inferred from a name` : ""} · ${n(c.generic)} company-wide · ${n(c.unassigned)} unassigned${n(c.review) ? ` · ${n(c.review)} on a domain to review` : ""}${n(c.phones) ? ` · ${n(c.phones)} ${n(c.phones) === 1 ? "phone" : "phones"}` : ""}${n(c.alreadyKnown) ? ` · ${n(c.alreadyKnown)} already known` : ""}${n(c.setAside) ? ` · ${n(c.setAside)} set aside` : ""}` : null;
    case "contacts": {
      if (c.lookups === undefined) return null;
      const per = FALLBACK_PROVIDERS.filter(p => n(c[`${p}_tried`]) || n(c[`${p}_skipped`]) || n(c[`${p}_failed`])).map(p => `${FALLBACK_LABEL[p]} ${n(c[`${p}_found`])}/${n(c[`${p}_tried`])} found${n(c[`${p}_skipped`]) ? `, ${n(c[`${p}_skipped`])} skipped` : ""}${n(c[`${p}_failed`]) ? `, ${n(c[`${p}_failed`])} failed` : ""}`);
      return `${n(c.lookups)} ${n(c.lookups) === 1 ? "lookup" : "lookups"} for ${n(c.considered)} ${n(c.considered) === 1 ? "person" : "people"} · ${n(c.found)} found${per.length ? ` · ${per.join(" · ")}` : ""}${n(c.alreadyTried) ? ` · ${n(c.alreadyTried)} tried recently, not repeated` : ""}`;
    }
    case "verify": {
      const results = Object.entries(c).filter(([k]) => k in CHECK_LABEL).map(([k, v]) => `${v} ${CHECK_LABEL[k as keyof typeof CHECK_LABEL].label.toLowerCase()}`);
      return c.checked !== undefined || c.cached !== undefined ? `${n(c.checked)} checked${results.length ? `: ${results.join(", ")}` : ""}${n(c.cached) ? ` · ${n(c.cached)} recently checked, not repeated` : ""}${n(c.notReturned) ? ` · ${n(c.notReturned)} returned no result` : ""}` : null;
    }
    default: return null;
  }
}
const stageText = (s: Stage) => ({ pending: "Waiting", running: STAGE_LABEL[s.key].running, done: STAGE_LABEL[s.key].done, no_matches: "No matches", skipped: "Skipped", needs_selection: "Needs your choice", blocked: "Not run", failed: "Failed", cancelled: "Cancelled" })[s.status];
const stageVariant = (s: Stage) => (s.status === "done" ? "success" : s.status === "failed" ? "danger" : s.status === "needs_selection" ? "warning" : s.status === "running" ? "info" : "neutral") as "success" | "danger" | "warning" | "info" | "neutral";

export function EnrichmentPanel({ opportunityId, opportunityTitle = "", initial, canResearch, canReveal, canConvert }: { opportunityId: string; opportunityTitle?: string; initial: Snapshot; canResearch: boolean; canReveal: boolean; canConvert: boolean }) {
  const router = useRouter();
  const [snap, setSnap] = useState(initial);
  const latest = initial.runs[0] ?? null;
  const [run, setRun] = useState<RunView | null>(latest && !TERMINAL.includes(latest.state as RunState) ? ({ ...latest, notice: null, apifyRuns: [], terminal: false } as unknown as RunView) : latest ? ({ ...latest, notice: null, apifyRuns: [], terminal: true } as unknown as RunView) : null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [offerFind, setOfferFind] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const current = useMemo(() => snap.people.filter(p => p.association !== "former"), [snap.people]);
  const [personId, setPersonId] = useState<string>("");
  // Keep a still-valid choice; otherwise choose nobody and ask, rather than silently picking someone.
  useEffect(() => { if (personId && !current.some(p => p.personId === personId)) setPersonId(""); }, [current, personId]);
  const active = Boolean(run && !TERMINAL.includes(run.state as RunState));

  const reload = useCallback(async () => { setSnap(await api.get<Snapshot>(`/api/opportunities/${opportunityId}/enrichment`)); router.refresh(); }, [opportunityId, router]);
  useEffect(() => {
    if (!run || !active) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const next = await api.get<RunView>(`/api/enrichment-runs/${run.id}`);
        if (stopped) return;
        setRun(next);
        if (next.terminal) { clearInterval(timer); await reload(); }
      } catch (e) { setMessage(e instanceof Error ? `${e.message} Progress is still saved on the server; reload to check.` : "Could not read progress."); clearInterval(timer); }
    }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [run, active, reload]);

  async function start(kind: RunKind) {
    setBusy(true); setMessage(""); setOfferFind(false);
    try { const r = await api.post<{ run: RunView; note: string | null }>(`/api/opportunities/${opportunityId}/enrichment`, { kind, refresh }); setRun({ ...r.run, terminal: false } as RunView); if (r.note) setMessage(r.note); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not start."); if (e instanceof ApiError && e.code === "no_addresses") setOfferFind(true); }
    finally { setBusy(false); }
  }
  async function control(path: string, body: object = {}) {
    if (!run) return; setBusy(true); setMessage("");
    try { await api.post(`/api/enrichment-runs/${run.id}/${path}`, body); setRun(await api.get<RunView>(`/api/enrichment-runs/${run.id}`)); }
    catch (e) { setMessage(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); }
  }
  async function decideDomain(domain: string, decision: "accept" | "reject") {
    setBusy(true); setMessage("");
    try {
      const r = await api.post<{ addresses: number }>(`/api/opportunities/${opportunityId}/email-domains`, { domain, decision });
      setMessage(decision === "accept" ? `${domain} is now treated as the company's email domain (${r.addresses} ${r.addresses === 1 ? "address" : "addresses"}). Run Find emails again to give a named address to its person.` : `${domain} was rejected. Its ${r.addresses === 1 ? "address stays" : "addresses stay"} as evidence and will not be checked or assigned.`);
      await reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not record that."); } finally { setBusy(false); }
  }
  async function toCrm() {
    setBusy(true); setMessage("");
    try { const r = await api.post<{ leadId: string; note: string | null }>(`/api/opportunities/${opportunityId}/crm`, { personId }); router.push(`/leads/${r.leadId}`); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not add to CRM."); setBusy(false); }
  }

  const stages = (run?.stages ?? []) as Stage[];
  const candidates = ((run?.result ?? {}) as { candidates?: Candidate[] }).candidates ?? [];
  const allowed = (k: RunKind) => (k === "research" ? canResearch : canReveal);
  const est = snap.estimates as unknown as Record<RunKind, { total: number; budget: number; note: string }>;

  return <div className="space-y-4">
    {!snap.setup.ready && <p role="status" className="rounded border border-warning-border bg-warning-subtle p-3 text-sm text-warning-text">{snap.setup.message} <Link href="/settings/providers" className="underline">Open settings</Link></p>}
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || active || !snap.setup.ready || !canReveal} onClick={() => start("enrich")}>Enrich opportunity</Button>
        {ACTIONS.map(a => <Button key={a.kind} variant="outline" title={a.hint} disabled={busy || active || !snap.setup.ready || !allowed(a.kind)} onClick={() => start(a.kind)}>{a.label}</Button>)}
        <label className="text-sm text-secondary"><input type="checkbox" checked={refresh} onChange={e => setRefresh(e.target.checked)} /> Run again even if recent</label>
      </div>
      <p className="text-xs text-secondary">Enrich runs company research, people, email discovery and email checks in order, skipping steps done in the last {snap.limits.freshDays} days. At most {money(est.enrich.total)} per run (budget {money(est.enrich.budget)}). {est.enrich.note} Nothing here sends any message.</p>
      {offerFind && <Button variant="outline" size="sm" disabled={busy || active} onClick={() => start("emails")}>Find emails now</Button>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {run && <RunStatus run={run} stages={stages} candidates={candidates} busy={busy} onCancel={() => control("cancel")} onRetry={() => control("retry")} onSelect={i => control("select", { index: i })} onNone={() => control("select", { none: true })} canChoose={canResearch} />}
    </section>
    <CompanyCard company={snap.company} contactPoints={snap.contactPoints} people={snap.people} canDecide={canResearch} busy={busy} onDecide={decideDomain} />
    <SourceContacts contacts={((run?.result ?? {}) as { sourceContacts?: SourceContact[] }).sourceContacts ?? []} />
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="font-semibold">People at this company <span className="tabular-nums text-secondary">({current.length})</span></h2>
      {!snap.people.length && <p className="text-sm text-secondary">Nobody identified yet. Use Find people: they are saved even without an email address.</p>}
      <ul className="space-y-2">{snap.people.map(p => <PersonRow key={p.employmentId} p={p} />)}</ul>
      <div className="flex flex-wrap items-end gap-2 rounded border border-border p-3">
        <label className="min-w-0 text-sm">Create a lead for
          <select aria-label="Person for the lead" value={personId} onChange={e => setPersonId(e.target.value)} className="ml-2 max-w-full rounded border border-border bg-surface p-1.5 text-sm">
            <option value="">{current.length ? "Choose a person…" : "No current people found yet"}</option>
            {current.map(p => <option key={p.personId} value={p.personId}>{p.name}{p.title ? ` — ${p.title}` : " — title unknown"}{p.association === "uncertain" ? " (association uncertain)" : ""}</option>)}
          </select></label>
        <Button variant="outline" disabled={busy || !personId || !canConvert} onClick={toCrm}>Add to CRM</Button>
        <p className="w-full text-xs text-secondary">An email address is not required. The lead keeps the opportunity&apos;s sources as signals and the person&apos;s LinkedIn profile as context. No outreach starts.</p>
      </div>
      {canConvert && <CompanyDeal companyId={snap.company.id} companyName={snap.company.name} defaultTitle={opportunityTitle} />}
    </section>
  </div>;
}

function RunStatus({ run, stages, candidates, busy, onCancel, onRetry, onSelect, onNone, canChoose }: { run: RunView; stages: Stage[]; candidates: Candidate[]; busy: boolean; onCancel: () => void; onRetry: () => void; onSelect: (i: number) => void; onNone: () => void; canChoose: boolean }) {
  const state = RUN_STATE_LABEL[run.state as RunState] ?? { label: run.state, variant: "neutral" as const };
  const active = !TERMINAL.includes(run.state as RunState);
  const reported = (run.apifyRuns ?? []).reduce((a, r) => a + (r.usageUsd ?? 0), 0);
  return <div aria-live="polite" className="space-y-2 rounded border border-border p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2"><Badge variant={state.variant}>{state.label}</Badge><span className="text-secondary">{run.kind === "enrich" ? "Enrich opportunity" : ACTIONS.find(a => a.kind === run.kind)?.label}{run.trigger === "auto" ? " · started automatically after discovery" : ""}</span>
      {active && <Button size="sm" variant="outline" disabled={busy || Boolean(run.cancelRequestedAt)} onClick={onCancel}>{run.cancelRequestedAt ? "Stopping…" : "Cancel"}</Button>}
      {["PARTIAL", "FAILED", "CANCELLED"].includes(run.state) && stages.some(s => ["failed", "cancelled"].includes(s.status)) && <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>Retry failed steps</Button>}
    </div>
    {run.notice && <p className="rounded border border-warning-border bg-warning-subtle p-2 text-warning-text">{run.notice}</p>}
    <ol className="space-y-1">{stages.map(s => <li key={s.key} className="min-w-0"><Badge variant={stageVariant(s)} size="sm">{stageText(s)}</Badge> <span className="font-medium">{STAGE_LABEL[s.key].done.replace(/ (identified|saved|discovered|checked|written|asked)$/, "")}</span>{stageCounts(s) && <span className="tabular-nums text-secondary"> · {stageCounts(s)}</span>}{s.reason && <span className="block break-words text-xs text-secondary">{s.reason}</span>}</li>)}</ol>
    {run.state === "NEEDS_SELECTION" && <div className="space-y-2 rounded border border-warning-border p-3">
      <p className="font-medium">Which company is this?</p>
      <ul className="space-y-2">{candidates.map((c, i) => <li key={c.profile.linkedinUrl} className="min-w-0 rounded border border-border p-2">
        <p><a href={c.profile.linkedinUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">{c.profile.name}</a> <span className="text-xs tabular-nums text-secondary">evidence score {c.score}/100</span></p>
        <p className="text-xs text-secondary">{[c.profile.domain, [c.profile.city, c.profile.country].filter(Boolean).join(", "), c.profile.industry, c.profile.employeeCount ? `${c.profile.employeeCount} employees` : null].filter(Boolean).join(" · ") || "Few details on this page."}</p>
        <p className="text-xs">{c.reasons.join(" ")}{c.conflicts.length ? <span className="text-warning-text"> {c.conflicts.join(" ")}</span> : null}</p>
        {canChoose && <Button size="sm" variant="outline" className="mt-1" disabled={busy} onClick={() => onSelect(i)}>This is the company</Button>}
      </li>)}</ul>
      {canChoose && <Button size="sm" variant="ghost" disabled={busy} onClick={onNone}>None of these</Button>}
    </div>}
    <p className="text-xs text-secondary tabular-nums">Estimated beforehand {money(run.estimatedUsd)} · {reported > 0 ? `Apify reported ${money(reported)}` : `recorded ${money(run.spentUsd)} (estimate where Apify reported none)`} · budget {money(run.budgetUsd)}</p>
  </div>;
}

type FieldProv = { source?: string; retrievedAt?: string; confidence?: number; confirmedBy?: string };
type EmailDomainRow = { domain: string; status: "alias" | "review" | "rejected"; basis: string; decidedBy?: string };
type SourceContact = { name: string; profileUrl: string | null; headline: string; why: string };
const DOMAIN_STATUS: Record<string, string> = { matched: "website domain", alias: "company email domain", review: "domain to review", rejected: "rejected domain", free: "free mailbox" };
const OWNERSHIP: Record<string, string> = { inferred_from_name: "inferred from the name, not confirmed", provider_associated: "associated by the provider, not confirmed" };
const FOUND_IN: Record<string, string> = { website: "on the website", source: "in the opportunity's source", company_profile: "on the company's profile", employee_search: "in the employee search", provider: "from a provider" };

function CompanyCard({ company, contactPoints, people, canDecide, busy, onDecide }: { company: Snapshot["company"]; contactPoints: Snapshot["contactPoints"]; people: Person[]; canDecide: boolean; busy: boolean; onDecide: (domain: string, decision: "accept" | "reject") => void }) {
  const e = (company.enrichment ?? {}) as { fields?: Record<string, FieldProv>; emailDomains?: EmailDomainRow[] };
  const prov = e.fields ?? {};
  const domains = e.emailDomains ?? [];
  const toReview = domains.filter(d => d.status === "review");
  const nameOf = (id: string | null) => (id ? people.find(p => p.personId === id)?.name ?? null : null);
  const row = (label: string, field: string, value: unknown, href?: string | null) => {
    const p = prov[field]; const shown = value === null || value === undefined || value === "" || value === "Unknown" ? null : String(value);
    return <div className="min-w-0"><dt className="text-xs text-secondary">{label}</dt><dd className="break-words">{shown ? (href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{shown}</a> : shown) : <span className="text-secondary">Unknown</span>}</dd>
      {shown && p && <dd className="text-xs text-secondary">{p.confirmedBy ? "Confirmed by a person" : `${p.source?.replace(/^apify:/, "via ")} · ${p.retrievedAt?.slice(0, 10)} · confidence ${p.confidence}/100`}</dd>}</div>;
  };
  const safeHref = (u: string | null) => (u && /^https:\/\//.test(u) ? u : null);
  const emails = contactPoints.filter(p => p.kind === "EMAIL");
  const phones = contactPoints.filter(p => p.kind === "PHONE");
  return <section className="space-y-3 rounded-xl border border-border p-4">
    <h2 className="font-semibold">Company</h2>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {row("Website", "website", company.website, safeHref(company.website))}{row("LinkedIn page", "linkedinUrl", company.linkedinUrl, safeHref(company.linkedinUrl))}{row("Industry", "industry", company.industry)}
      {row("Location", "city", [company.city, company.state].filter(Boolean).join(", ") || null)}{row("Country", "country", company.country)}{row("Employees", "employeeCount", company.employeeCount ?? company.employeeBand)}
    </dl>
    {company.description && <p className="text-sm text-secondary">{company.description}</p>}
    {toReview.length > 0 && <div className="space-y-2 rounded border border-warning-border p-3">
      <h3 className="text-sm font-medium">Email domains to review</h3>
      <p className="text-xs text-secondary">Addresses on these domains were found near this company, but nothing ties the domain to it. Until you decide, they are kept as evidence and never checked or given to a person.</p>
      <ul className="space-y-2">{toReview.map(d => <li key={d.domain} className="min-w-0 text-sm"><span className="break-words font-medium">{d.domain}</span> <span className="text-xs text-secondary">· {d.basis}</span>
        {canDecide && <span className="mt-1 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(d.domain, "accept")}>It is the company&apos;s</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(d.domain, "reject")}>Not the company&apos;s</Button></span>}</li>)}</ul>
    </div>}
    {domains.some(d => d.status === "alias") && <p className="text-xs text-secondary">Also the company&apos;s email {domains.filter(d => d.status === "alias").length === 1 ? "domain" : "domains"}: {domains.filter(d => d.status === "alias").map(d => `${d.domain} (${d.decidedBy ? "confirmed by a person" : d.basis.replace(/\.$/, "").toLowerCase()})`).join("; ")}.</p>}
    {emails.length > 0 && <div><h3 className="text-sm font-medium">Company-wide and unassigned addresses</h3><p className="text-xs text-secondary">Not given to any person: role addresses, addresses that do not clearly name someone saved, and addresses on a domain not yet tied to the company.</p>
      <ul className="mt-1 space-y-1 text-sm">{emails.map(p => { const ev = (p.evidence ?? {}) as { url?: string | null; kind?: string }; const maybe = nameOf(p.possiblePersonId); return <li key={p.id} className="min-w-0 break-words">{p.value} <span className="text-xs text-secondary">· {p.isGeneric ? "role address" : maybe ? `may be ${maybe}'s — inferred from the name, not attached` : "names an unidentified person"} · {DOMAIN_STATUS[p.domainStatus] ?? p.domainStatus} · {["matched", "alias"].includes(p.domainStatus) ? CHECK_LABEL[p.verificationResult as keyof typeof CHECK_LABEL]?.label ?? p.verificationResult : "not checked"} · found {FOUND_IN[ev.kind ?? ""] ?? "in the evidence"}{ev.url && safeHref(ev.url) ? <> (<a className="underline" href={safeHref(ev.url) ?? undefined} target="_blank" rel="noopener noreferrer">page</a>)</> : null}</span></li>; })}</ul></div>}
    {phones.length > 0 && <div><h3 className="text-sm font-medium">Published phone numbers</h3>
      <ul className="mt-1 space-y-1 text-sm tabular-nums">{phones.map(p => { const ev = (p.evidence ?? {}) as { url?: string | null; kind?: string }; return <li key={p.id} className="min-w-0 break-words">{p.value} <span className="text-xs text-secondary">· company line, found {FOUND_IN[ev.kind ?? ""] ?? "in the evidence"} · not verified</span></li>; })}</ul></div>}
  </section>;
}

/** People named in the opportunity's source who are not shown to work at the buyer, such as a recruiter posting for a client. */
function SourceContacts({ contacts }: { contacts: SourceContact[] }) {
  if (!contacts.length) return null;
  return <section className="space-y-2 rounded-xl border border-border p-4">
    <h2 className="font-semibold">Named in the source</h2>
    <p className="text-xs text-secondary">These people posted or were named in the opportunity&apos;s source, but nothing shows they work at this company — often a recruiter or agency. They are not saved as the company&apos;s people.</p>
    <ul className="space-y-1 text-sm">{contacts.map(c => <li key={`${c.name}-${c.profileUrl}`} className="min-w-0 break-words">{c.profileUrl && /^https:\/\//.test(c.profileUrl) ? <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">{c.name}</a> : <span className="font-medium">{c.name}</span>}{c.headline ? <span className="text-secondary"> · {c.headline}</span> : null}<span className="block text-xs text-secondary">{c.why}</span></li>)}</ul>
  </section>;
}

function PersonRow({ p }: { p: Person }) {
  const ev = (p.evidence ?? {}) as { association?: { basis?: string }; relevance?: string[]; authority?: { basis?: string; likelyDecisionMaker?: boolean }; source?: string };
  return <li className="min-w-0 rounded border border-border p-3 text-sm">
    <p className="break-words">{p.linkedinUrl ? <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">{p.name}</a> : <span className="font-medium">{p.name}</span>} · {p.title || <span className="text-secondary">Title unknown</span>}</p>
    <p className="text-xs text-secondary">{[`${ASSOCIATION[p.association] ?? p.association}${ev.association?.basis ? ` — ${ev.association.basis}` : ""}`, [p.city, p.country !== "Unknown" ? p.country : null].filter(Boolean).join(", "), p.source ? (p.source === "post_author" ? "author of the opportunity's post" : p.source.replace(/^apify:/, "via ")) : ""].filter(Boolean).join(" · ")}</p>
    {p.isDecisionMaker && <p className="text-xs text-secondary">Possibly a decision maker — inferred from the title, not confirmed.</p>}
    {ev.relevance && ev.relevance.length > 0 && <p className="text-xs text-secondary">Why relevant: {ev.relevance.join(" ")}</p>}
    {p.contacts.length ? <ul className="mt-1 space-y-0.5">{p.contacts.map(c => { const basis = ((c.provenance ?? {}) as { ownership?: { basis?: string } }).ownership?.basis; return <li key={c.id} className="break-words">{c.value ?? "Locked"} <span className="text-xs text-secondary">{basis ? `· ${OWNERSHIP[basis] ?? basis} ` : ""}· {CHECK_LABEL[c.verificationResult as keyof typeof CHECK_LABEL]?.label ?? c.verificationResult}{c.verifiedAt ? ` on ${c.verifiedAt.slice(0, 10)}` : ""} · {c.source.replace(/^apify:/, "found via ")}</span></li>; })}</ul> : <p className="mt-1 text-xs text-secondary">No email found for this person.</p>}
  </li>;
}

/** A company-level CRM record when nobody at the company is known yet: an open deal with no lead. */
function CompanyDeal({ companyId, companyName, defaultTitle }: { companyId: string; companyName: string; defaultTitle: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false); const [title, setTitle] = useState(defaultTitle.slice(0, 200)); const [value, setValue] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function create() {
    setBusy(true); setMessage("");
    try { await api.post("/api/deals", { companyId, title: title.trim() || undefined, valueInr: Number(value) }); setMessage(`Added to the pipeline as a deal for ${companyName}, with no contact yet. Add a person later from this page.`); setOpen(false); router.refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not add the deal."); } finally { setBusy(false); }
  }
  return <div className="rounded border border-border p-3 text-sm">
    {!open ? <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Nobody to contact yet? Add {companyName} to the pipeline</Button> : <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-sm">Deal title<input aria-label="Deal title" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} className="mt-1 block w-full rounded border border-border bg-surface p-1.5 text-sm" /></label>
      <label className="text-sm">Estimated value (₹)<input aria-label="Estimated value" type="number" min={0} value={value} onChange={e => setValue(e.target.value)} className="mt-1 block w-36 rounded border border-border bg-surface p-1.5 text-sm tabular-nums" /></label>
      <Button size="sm" variant="outline" disabled={busy || value === "" || Number(value) < 0} onClick={create}>Add deal</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      <p className="w-full text-xs text-secondary">Enter your own estimate; nothing is filled in for you. The deal belongs to the company, not a person, and starts no outreach.</p></div>}
    {message && <p role="status" className="mt-1 text-xs">{message}</p>}
  </div>;
}
