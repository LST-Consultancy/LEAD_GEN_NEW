"use client";
import { Input } from "@/components/ui/input";
import { PLATFORM_META, type ApifyPlatformId, type PlatformConfig } from "@/lib/opportunities/apify-platform-meta";

/** One Apify discovery platform's limits. The price shown is the Actor's listed one, labelled as such. */
export function PlatformSettings({ id, value, onChange }: { id: ApifyPlatformId; value: PlatformConfig; onChange: (v: PlatformConfig) => void }) {
  const p = PLATFORM_META[id];
  const set = (patch: Partial<PlatformConfig>) => onChange({ ...value, ...patch });
  const int = (key: "maxQueries" | "maxItemsPerQuery", label: string, min: number, max: number) => <label className="block text-sm">{label}<Input type="number" min={min} max={max} value={value[key]} onChange={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= min && v <= max) set({ [key]: v }); }} className="mt-1 max-w-32 tabular-nums" /></label>;
  const list = (v: string) => v.split(/\n|,/).map(s => s.trim()).filter(Boolean);
  return <fieldset className="space-y-3 rounded border border-border p-3">
    <legend className="px-1 text-sm font-medium">{p.name}</legend>
    <p className="text-xs text-secondary">Actor <code>{value.actor ?? p.actor}</code> · {p.priceNote} {p.resultClass === "hiring" ? "Results are job postings: internal hiring, kept apart from requests for a vendor." : p.resultClass === "business_prospect" ? "Results are businesses saved as prospects — fit evidence, never intent." : "Results are requests to assess; a buyer must be named for one to become an opportunity."}</p>
    <label className="block min-w-0 text-sm">Actor (replace only with one that takes the same input and returns the same fields)<Input value={value.actor ?? ""} placeholder={p.actor} onChange={e => set({ actor: e.target.value.trim() || undefined })} className="mt-1 font-mono text-xs" /></label>
    <div className="grid gap-3 md:grid-cols-3">
      {id !== "apify_websites" && id !== "apify_google_maps" && int("maxQueries", "Queries per search", 1, 5)}
      {int("maxItemsPerQuery", id === "apify_websites" ? "Pages to read" : id === "apify_google_maps" ? "Places per category" : "Results per query", 5, 200)}
      <label className="block text-sm">Most one search may spend here (USD)<Input type="number" min={0.01} max={20} step={0.05} value={value.maxUsdPerSearch} onChange={e => { const v = Number(e.target.value); if (v >= 0.01 && v <= 20) set({ maxUsdPerSearch: v }); }} className="mt-1 max-w-32 tabular-nums" /></label>
      {["apify_indeed", "apify_google_search"].includes(id) && <label className="block text-sm">Country code<Input value={value.country} maxLength={2} onChange={e => { const v = e.target.value.toLowerCase(); if (/^[a-z]{0,2}$/.test(v)) set({ country: v || "in" }); }} className="mt-1 max-w-20" /></label>}
      {["apify_linkedin_jobs", "apify_indeed", "apify_naukri", "apify_google_maps"].includes(id) && <label className="block text-sm">Location {id === "apify_google_maps" ? "(required)" : "(optional; else the search's first location)"}<Input value={value.location} onChange={e => set({ location: e.target.value })} className="mt-1" /></label>}
    </div>
    {id === "apify_google_maps" && <label className="block text-sm">Business categories, one per line<textarea className="mt-1 block w-full rounded border border-border bg-surface p-2 text-sm" rows={3} value={value.mapsQueries.join("\n")} onChange={e => set({ mapsQueries: list(e.target.value).slice(0, 5) })} placeholder={"manufacturing company\nlogistics company"} /><span className="text-xs text-secondary">Blank uses the search&apos;s industries.</span></label>}
    {id === "apify_websites" && <label className="block text-sm">Pages to read, one URL per line<textarea className="mt-1 block w-full rounded border border-border bg-surface p-2 text-sm" rows={3} value={value.startUrls.join("\n")} onChange={e => set({ startUrls: list(e.target.value).slice(0, 10) })} placeholder="https://example.org/tenders" /><span className="text-xs text-secondary">robots.txt is respected; links are followed two levels deep, within the page limit.</span></label>}
  </fieldset>;
}
