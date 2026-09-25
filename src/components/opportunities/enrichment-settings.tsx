"use client";
import { Input } from "@/components/ui/input";
import { FALLBACK_LABEL, FALLBACK_PROVIDERS, type FallbackProvider } from "@/lib/enrichment/fallback";
import { DEFAULT_ACTORS, EMPLOYEE_MODES, estimate, money, PRICE_NOTE, type EnrichmentConfig } from "@/lib/enrichment/config";

const ROLES: { key: keyof EnrichmentConfig["actors"]; label: string }[] = [
  { key: "search", label: "Company search (website and LinkedIn page)" },
  { key: "company", label: "Company profile" },
  { key: "employees", label: "Employee search" },
  { key: "website", label: "Website contact finder" },
  { key: "verify", label: "Email checker (a list of addresses)" },
];
const select = "ml-2 rounded border border-border bg-surface p-1.5 text-sm";

/** Apify enrichment settings. Every figure beside a control is an estimate from listed prices, labelled as one. */
export function EnrichmentSettings({ value, onChange }: { value: EnrichmentConfig; onChange: (v: EnrichmentConfig) => void }) {
  const set = (patch: Partial<EnrichmentConfig>) => onChange({ ...value, ...patch });
  const num = (key: "peoplePerCompany" | "websitePages" | "emailChecksPerRun" | "verifyCacheDays" | "freshDays" | "runTimeoutSec", label: string, min: number, max: number, hint?: string) => <label className="block text-sm">{label}<Input type="number" min={min} max={max} value={value[key]} onChange={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= min && v <= max) set({ [key]: v }); }} className="mt-1 max-w-32 tabular-nums" />{hint && <span className="text-xs text-secondary">{hint}</span>}</label>;
  const fb = value.fallback;
  const setFb = (patch: Partial<EnrichmentConfig["fallback"]>) => set({ fallback: { ...fb, ...patch } });
  const move = (p: FallbackProvider, dir: -1 | 1) => { const o = [...fb.order]; const i = o.indexOf(p); const j = i + dir; if (i < 0 || j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setFb({ order: o }); };
  const toggle = (p: FallbackProvider, on: boolean) => { const o = on ? [...fb.order, p] : fb.order.filter(x => x !== p); if (o.length) setFb({ order: o }); };
  return <fieldset className="space-y-4 rounded border border-border p-3">
    <legend className="px-1 text-sm font-medium">Apify enrichment</legend>
    <p className="text-xs text-secondary">Uses only Apify Actors, billed to your Apify account. The defaults were checked against each Actor&apos;s published input and output on 24 September 2026. Replace one only with an Actor that takes the same input and returns the same fields, or its results will not be read. {PRICE_NOTE}</p>
    <div className="grid gap-3 md:grid-cols-2">{ROLES.map(r => <label key={r.key} className="block min-w-0 text-sm">{r.label}<Input value={value.actors[r.key]} onChange={e => set({ actors: { ...value.actors, [r.key]: e.target.value } })} placeholder={DEFAULT_ACTORS[r.key]} className="mt-1 font-mono text-xs" /></label>)}</div>
    <label className="block text-sm">Email checker output format<select aria-label="Email checker output format" value={value.verifierFormat} onChange={e => set({ verifierFormat: e.target.value as EnrichmentConfig["verifierFormat"] })} className={select}><option value="bounceverify">BounceVerify (bounceverify/bounceverify-email-verifier)</option><option value="michael_g">Email Verifier &amp; Validator (michael.g/email-verifier-validator)</option></select>
      <span className="block text-xs text-secondary">Must match the checker Actor above. Listed FREE-tier prices: BounceVerify $0.00089 per email; michael.g $0.10 per email ($0.001 from Apify&apos;s Bronze plan).</span></label>
    <label className="block text-sm">Employee profile detail<select aria-label="Employee profile detail" value={value.employeeMode} onChange={e => set({ employeeMode: e.target.value as EnrichmentConfig["employeeMode"] })} className={select}>{EMPLOYEE_MODES.map(m => <option key={m} value={m}>{m}</option>)}</select>
      <span className="block text-xs text-secondary">Full is needed to tell current from former employees. The email-search mode&apos;s output field is not documented by the Actor, so emails it returns are marked as such.</span></label>
    <div className="grid gap-3 md:grid-cols-3">
      {num("peoplePerCompany", "People per company", 1, 50, `≈ ${money(estimate.employees(value.peoplePerCompany * 2, value.employeeMode))} per search (up to ${value.peoplePerCompany * 2} profiles read)`)}
      {num("websitePages", "Website pages to scan", 1, 50, `≈ ${money(estimate.website(value.websitePages))} per website`)}
      {num("emailChecksPerRun", "Email checks per run", 1, 200, `≈ ${money(estimate.verify(value.emailChecksPerRun, value.verifierFormat))} at most`)}
      {num("verifyCacheDays", "Re-check an address after (days)", 1, 365)}
      {num("freshDays", "Treat research as fresh for (days)", 1, 365)}
      {num("runTimeoutSec", "Longest one Actor run may take (seconds)", 60, 600)}
    </div>
    <label className="block text-sm">Budget per run (USD)<Input type="number" min={0.05} max={50} step={0.05} value={value.maxUsdPerRun} onChange={e => { const v = Number(e.target.value); if (v >= 0.05 && v <= 50) set({ maxUsdPerRun: v }); }} className="mt-1 max-w-32 tabular-nums" /><span className="text-xs text-secondary">A step whose estimate would exceed what is left is skipped, and Apify is told the remaining amount as the run&apos;s charge limit.</span></label>
    <div className="space-y-2 rounded border border-border p-3">
      <label className="block text-sm"><input type="checkbox" checked={fb.enabled} onChange={e => setFb({ enabled: e.target.checked })} /> After Apify, ask contact providers for people still without a company email</label>
      <p className="text-xs text-secondary">Uses your own SignalHire, Hunter and Apollo connections (each set up separately below), in this order, stopping for a person at the first one that returns an address. Each lookup can spend one of that provider&apos;s credits; they are billed by the provider, not estimated here. A provider that is not connected, or lacks what it needs for a person, is skipped and the run says why.</p>
      {fb.enabled && <div className="space-y-2">
        <ol className="space-y-1">{fb.order.map((p, i) => <li key={p} className="flex flex-wrap items-center gap-2 text-sm"><span className="tabular-nums text-secondary">{i + 1}.</span><span className="font-medium">{FALLBACK_LABEL[p]}</span>
          <button type="button" className="rounded border border-border px-1.5 text-xs disabled:opacity-50" disabled={i === 0} onClick={() => move(p, -1)} aria-label={`Move ${FALLBACK_LABEL[p]} earlier`}>↑</button>
          <button type="button" className="rounded border border-border px-1.5 text-xs disabled:opacity-50" disabled={i === fb.order.length - 1} onClick={() => move(p, 1)} aria-label={`Move ${FALLBACK_LABEL[p]} later`}>↓</button>
          <button type="button" className="text-xs underline disabled:opacity-50" disabled={fb.order.length === 1} onClick={() => toggle(p, false)}>Don&apos;t use</button></li>)}</ol>
        {FALLBACK_PROVIDERS.filter(p => !fb.order.includes(p)).map(p => <button key={p} type="button" className="mr-2 text-xs underline" onClick={() => toggle(p, true)}>Also use {FALLBACK_LABEL[p]}</button>)}
        <label className="block text-sm">Provider lookups per run, across all providers<Input type="number" min={1} max={50} value={fb.maxLookupsPerRun} onChange={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 1 && v <= 50) setFb({ maxLookupsPerRun: v }); }} className="mt-1 max-w-32 tabular-nums" /></label>
      </div>}
    </div>
    <div className="space-y-2 rounded border border-border p-3">
      <label className="block text-sm"><input type="checkbox" checked={value.autoEnrich.enabled} onChange={e => set({ autoEnrich: { ...value.autoEnrich, enabled: e.target.checked } })} /> Enrich newly qualified opportunities automatically after a discovery search</label>
      {value.autoEnrich.enabled && <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">Only at intent score of at least<Input type="number" min={0} max={100} value={value.autoEnrich.minIntent} onChange={e => set({ autoEnrich: { ...value.autoEnrich, minIntent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })} className="mt-1 max-w-32 tabular-nums" /></label>
        <label className="block text-sm">At most this many a day<Input type="number" min={1} max={100} value={value.autoEnrich.maxPerDay} onChange={e => set({ autoEnrich: { ...value.autoEnrich, maxPerDay: Math.max(1, Math.min(100, Number(e.target.value) || 1)) } })} className="mt-1 max-w-32 tabular-nums" /></label>
      </div>}
      <p className="text-xs text-secondary">Off by default. Only qualified opportunities are enriched, never raw posts or review candidates; each run keeps the per-run budget above, so the most this can spend a day is {value.autoEnrich.maxPerDay} × {money(value.maxUsdPerRun)}.</p>
    </div>
  </fieldset>;
}
