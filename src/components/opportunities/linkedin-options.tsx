"use client";
import { useState } from "react";
import { Textarea } from "@/components/ui/input";
import type { SearchCriteria } from "@/lib/opportunities/query-parser";
import { APIFY_PRICE_NOTE, DEPTHS, effectivePlan, estimatedCostUsd, INTENTS, linkedInDateWindow, resolveOptions, type DiscoveryOptions } from "@/lib/opportunities/linkedin-plan";

const DEPTH_LABEL = { quick: "Quick", standard: "Standard", deep: "Deep", custom: "Custom" } as const;
const DATE_CHOICES = [1, 7, 14, 30, 60, 90];
const select = "ml-2 rounded border border-border bg-surface px-2 py-1 text-sm";
const intentLabel = (id: string) => INTENTS.find(i => i.id === id)?.label ?? "Edited";

/**
 * Depth, target, budget, date range and the exact queries for a LinkedIn run. Collapsed by
 * default; the summary line states what the defaults will do and cost, so nobody has to open it
 * to know.
 */
export function LinkedInOptions({ criteria, query, options, onOptions, days, onDays, workspaceMaxPosts }: {
  criteria: SearchCriteria; query: string; options: DiscoveryOptions; onOptions: (o: DiscoveryOptions) => void;
  days: number; onDays: (d: number) => void; workspaceMaxPosts: number;
}) {
  const [editing, setEditing] = useState(false);
  const resolved = resolveOptions(options, workspaceMaxPosts);
  const plan = effectivePlan({ ...criteria, dateRange: { days } }, resolved, query);
  const window = linkedInDateWindow(days);
  const set = (patch: Partial<DiscoveryOptions>) => onOptions({ ...options, ...patch });
  const num = (key: "targetQualified" | "maxPosts" | "maxPagesPerQuery" | "postsPerPage" | "maxQueries", min: number, max: number) => (
    <input type="number" min={min} max={max} value={options[key] ?? resolved[key]} onChange={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= min && v <= max) set({ depth: "custom", [key]: v }); }} className={`${select} w-20 tabular-nums`} />
  );
  return (
    <details className="rounded border border-border p-3 text-sm">
      <summary className="cursor-pointer">
        LinkedIn search: <span className="font-medium">{DEPTH_LABEL[resolved.depth]}</span>
        <span className="tabular-nums text-secondary"> · {plan.length} {plan.length === 1 ? "query" : "queries"} · up to {resolved.maxPagesPerQuery} {resolved.maxPagesPerQuery === 1 ? "page" : "pages"} each · target {resolved.targetQualified} qualified · at most {resolved.maxPosts} posts (≈ ${estimatedCostUsd(resolved.maxPosts).toFixed(2)})</span>
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label>Depth<select aria-label="Search depth" value={options.depth} onChange={e => { const depth = e.target.value as DiscoveryOptions["depth"]; onOptions({ depth, strictFilters: options.strictFilters, queries: options.queries }); }} className={select}>
            {(["quick", "standard", "deep", "custom"] as const).map(d => <option key={d} value={d}>{DEPTH_LABEL[d]}</option>)}
          </select></label>
          <label>Date range<select aria-label="Date range" value={days} onChange={e => onDays(Number(e.target.value))} className={select}>
            {[...new Set([...DATE_CHOICES, days])].sort((a, b) => a - b).map(d => <option key={d} value={d}>{d === 1 ? "Past 24 hours" : `Past ${d} days`}</option>)}
          </select></label>
          <label>Qualified target{num("targetQualified", 1, 200)}</label>
          <label>Post budget{num("maxPosts", 10, 5000)}</label>
        </div>
        {options.depth === "custom" && <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label>Queries{num("maxQueries", 1, 24)}</label>
          <label>Pages per query{num("maxPagesPerQuery", 1, 10)}</label>
          <label>Posts per page{num("postsPerPage", 10, 50)}</label>
        </div>}
        <label className="block"><input type="checkbox" checked={options.strictFilters} onChange={e => set({ strictFilters: e.target.checked })} /> Strict filters: reject posts whose company size, location or industry is not stated, instead of keeping them for review</label>
        <ul className="space-y-1 text-xs text-secondary">
          <li>The search stops at whichever comes first: the qualified target, the post budget, available results running out, or {Math.round(resolved.maxRuntimeSec / 60)} minutes. The target is a goal, not a promise.</li>
          <li>Apify bills per post returned, so the budget is the most this search can cost: {resolved.maxPosts} posts ≈ ${estimatedCostUsd(resolved.maxPosts).toFixed(2)} {APIFY_PRICE_NOTE}. Stopping early costs less. Presets: {Object.entries(DEPTHS).map(([k, v]) => `${DEPTH_LABEL[k as keyof typeof DEPTHS]} ${v.maxPosts}`).join(" · ")} posts.</li>
          {resolved.cappedBy !== null && <li className="text-warning-text">Capped at {resolved.cappedBy} posts by this workspace&apos;s LinkedIn source setting.</li>}
          {window.note && <li>{window.note}</li>}
        </ul>
        <div>
          <div className="flex items-center justify-between gap-2"><p className="font-medium">Queries sent to LinkedIn{resolved.queries ? " (edited)" : ""}</p>
            <div className="flex gap-3 text-xs">{resolved.queries && <button type="button" className="underline" onClick={() => { set({ queries: undefined }); setEditing(false); }}>Reset to generated</button>}<button type="button" className="underline" onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit queries"}</button></div></div>
          {editing
            ? <><Textarea aria-label="LinkedIn queries, one per line" rows={Math.min(12, Math.max(4, plan.length + 1))} defaultValue={plan.map(p => p.keyword).join("\n")} onBlur={e => { const lines = e.target.value.split("\n").map(l => l.trim()).filter(l => l.length >= 3).slice(0, 24); set({ queries: lines.length ? lines : undefined }); }} className="mt-2 font-mono text-xs" />
              <p className="mt-1 text-xs text-secondary">One query per line, up to 24. LinkedIn syntax: &quot;exact phrase&quot;, OR, NOT and parentheses. An edited list is sent exactly as written.</p></>
            : plan.length
              ? <ol className="mt-2 space-y-1">{plan.map((p, i) => <li key={p.keyword} className="min-w-0"><span className="tabular-nums text-secondary">{i + 1}.</span> <code className="break-words text-xs">{p.keyword}</code> <span className="text-xs text-secondary">· {intentLabel(p.intent)}{p.alias ? " · alias" : ""}</span></li>)}</ol>
              : <p className="mt-2 text-secondary">No subject could be read from this search, so there is nothing to send. Name a product, technology or service.</p>}
        </div>
      </div>
    </details>
  );
}
