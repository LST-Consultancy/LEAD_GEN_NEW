"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { listOfferings } from "@/lib/services/offerings";

type Offering = Awaited<ReturnType<typeof listOfferings>>[number];
type Draft = { name: string; description: string; services: string; technologies: string; buyerPhrases: string; jobTitles: string; prospectCategories: string; industries: string; locations: string; negativeKeywords: string; employeeMin: string; employeeMax: string };
const EMPTY: Draft = { name: "", description: "", services: "", technologies: "", buyerPhrases: "", jobTitles: "", prospectCategories: "", industries: "", locations: "", negativeKeywords: "", employeeMin: "", employeeMax: "" };
const lines = (v: string) => v.split("\n").map(s => s.trim()).filter(Boolean);
const toDraft = (o: Offering): Draft => ({ name: o.name, description: o.description, services: o.services.join("\n"), technologies: o.technologies.join("\n"), buyerPhrases: o.buyerPhrases.join("\n"), jobTitles: o.jobTitles.join("\n"), prospectCategories: o.prospectCategories.join("\n"), industries: o.industries.join("\n"), locations: o.locations.join("\n"), negativeKeywords: o.negativeKeywords.join("\n"), employeeMin: o.employeeMin?.toString() ?? "", employeeMax: o.employeeMax?.toString() ?? "" });

const FIELDS: { key: keyof Draft; label: string; hint: string; placeholder: string; group: "intent" | "fit" }[] = [
  { key: "services", label: "Services", hint: "What you deliver, in your words.", placeholder: "NetSuite implementation\nERP integration", group: "intent" },
  { key: "technologies", label: "Technologies", hint: "Products a buyer would name.", placeholder: "NetSuite\nSuiteScript", group: "intent" },
  { key: "buyerPhrases", label: "How buyers ask", hint: "Sent to Google, Reddit and Upwork. Write it the way a buyer posts it.", placeholder: "looking for a NetSuite partner\nNetSuite RFP", group: "intent" },
  { key: "jobTitles", label: "Job titles that signal need", hint: "Sent to LinkedIn jobs, Indeed and Naukri. A company hiring this role may need your help — hiring is still not a request for a vendor.", placeholder: "NetSuite Administrator\nERP Consultant", group: "intent" },
  { key: "prospectCategories", label: "Business categories", hint: "Sent to Google Maps. Businesses found are saved as prospects, never as opportunities.", placeholder: "wholesale distributor\nmanufacturing company", group: "intent" },
  { key: "locations", label: "Where", hint: "The search area for every platform.", placeholder: "India\nPune", group: "intent" },
  { key: "negativeKeywords", label: "Exclude", hint: "Posts containing these are ignored.", placeholder: "internship", group: "intent" },
  { key: "industries", label: "Industries you fit", hint: "Fit only — not a search filter. Your ICP scores fit.", placeholder: "Distribution\nManufacturing", group: "fit" },
];

export function OfferingsEditor({ initial, canManage }: { initial: Offering[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(initial.length ? null : "new");
  const [draft, setDraft] = useState<Draft>(EMPTY); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const set = (k: keyof Draft, v: string) => setDraft(d => ({ ...d, [k]: v }));
  async function save() {
    setBusy(true); setMessage("");
    const body = { name: draft.name, description: draft.description, services: lines(draft.services), technologies: lines(draft.technologies), buyerPhrases: lines(draft.buyerPhrases), jobTitles: lines(draft.jobTitles), prospectCategories: lines(draft.prospectCategories), industries: lines(draft.industries), locations: lines(draft.locations), negativeKeywords: lines(draft.negativeKeywords), employeeMin: draft.employeeMin ? Number(draft.employeeMin) : null, employeeMax: draft.employeeMax ? Number(draft.employeeMax) : null };
    try { if (editing === "new") await api.post("/api/offerings", body); else await api.put(`/api/offerings/${editing}`, body); setEditing(null); setMessage("Saved. Use it from Find Opportunities → Start from an offering."); router.refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  async function remove(o: Offering) {
    if (!window.confirm(`Delete “${o.name}”? Searches already run from it keep their results. You can restore it from the recycle bin.`)) return;
    setBusy(true); try { await api.del(`/api/offerings/${o.id}`); setMessage(`“${o.name}” moved to the recycle bin.`); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not delete."); } finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-4xl space-y-5 p-6">
    <header><h1 className="text-2xl font-semibold">Offerings</h1><p className="mt-1 text-sm text-secondary">What you sell, written once, so each discovery platform is asked the way its users write. Requests, job postings and business listings are kept apart in the results, and fit stays with your <Link href="/settings/icp" className="underline">ICP</Link>.</p></header>
    {message && <p role="status" className="rounded border border-border p-3 text-sm">{message}</p>}
    {initial.length === 0 && editing !== "new" && <p className="text-sm text-secondary">No offerings yet.</p>}
    <ul className="space-y-3">{initial.map(o => <li key={o.id} className="min-w-0 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{o.name}</h2>{canManage && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setDraft(toDraft(o)); setEditing(o.id); }}>Edit</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(o)}>Delete</Button></div>}</div>
      {o.description && <p className="mt-1 text-sm text-secondary">{o.description}</p>}
      <p className="mt-2 break-words text-xs text-secondary">Searches “{o.preview.query}”{o.buyerPhrases.length ? ` · asks: ${o.buyerPhrases.join(" · ")}` : ""}{o.jobTitles.length ? ` · job titles: ${o.jobTitles.join(" · ")}` : ""}{o.prospectCategories.length ? ` · Maps: ${o.prospectCategories.join(" · ")}` : ""}</p>
    </li>)}</ul>
    {canManage && editing === null && <Button onClick={() => { setDraft(EMPTY); setEditing("new"); }}>Add offering</Button>}
    {!canManage && <p className="text-xs text-secondary">Only members who can manage the ICP can change offerings.</p>}
    {canManage && editing !== null && <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">{editing === "new" ? "New offering" : "Edit offering"}</h2>
      <label className="block text-sm">Name<Input required minLength={2} maxLength={80} value={draft.name} onChange={e => set("name", e.target.value)} className="mt-1" /></label>
      <label className="block text-sm">Description (optional)<textarea maxLength={1000} rows={2} value={draft.description} onChange={e => set("description", e.target.value)} className="mt-1 block w-full rounded border border-border bg-surface p-2 text-sm" /></label>
      <div className="grid gap-4 md:grid-cols-2">{FIELDS.map(f => <label key={f.key} className="block min-w-0 text-sm">{f.label}<textarea rows={3} value={draft[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} className="mt-1 block w-full rounded border border-border bg-surface p-2 text-sm" /><span className="text-xs text-secondary">{f.hint} One per line.</span></label>)}</div>
      <div className="flex flex-wrap gap-3"><label className="block text-sm">Company size from<Input type="number" min={0} value={draft.employeeMin} onChange={e => set("employeeMin", e.target.value)} className="mt-1 max-w-32 tabular-nums" /></label><label className="block text-sm">to<Input type="number" min={1} value={draft.employeeMax} onChange={e => set("employeeMax", e.target.value)} className="mt-1 max-w-32 tabular-nums" /></label><p className="self-end text-xs text-secondary">Fit only; not a search filter.</p></div>
      <div className="flex gap-2"><Button type="submit" disabled={busy}>Save offering</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
    </form>}
  </div>;
}
