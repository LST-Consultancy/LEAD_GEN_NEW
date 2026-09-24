"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
type Person = { personId: string; name: string; title: string; likelyDecisionMaker: boolean };
export function OpportunityActions({ id, people = [] }: { id: string; people?: Person[] }) {
  const [personId, setPersonId] = useState(people[0]?.personId ?? "");
  const router = useRouter(); const [jobId, setJobId] = useState<string | null>(null); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { if (!jobId) return; const timer = setInterval(async () => { try { const r = await api.get<{ state: string; error: string | null }>(`/api/opportunities/actions/${jobId}`); setMessage(r.error ?? r.state); if (["COMPLETED", "FAILED"].includes(r.state)) { setJobId(null); router.refresh(); } } catch { setMessage("Could not retrieve operation status. Check the job monitor."); } }, 2500); return () => clearInterval(timer); }, [jobId, router]);
  async function run(action: string) { setBusy(action); setMessage(""); try { const r = await api.post<{ note?: string | null; leadId?: string; jobId?: string }>(`/api/opportunities/${id}/${action}`, action === "crm" ? { personId } : {}); if (r.jobId) setJobId(r.jobId); if (r.leadId) router.push(`/leads/${r.leadId}`); else { setMessage(r.note ?? "Research saved with source citations."); router.refresh(); } } catch (e) { setMessage(e instanceof Error ? e.message : "Operation failed."); } finally { setBusy(""); } }
  return <div className="space-y-3"><div className="flex flex-wrap gap-2">{[["research", "Research company"], ["enrich", "Find people"], ["verify", "Verify emails"]].map(([action,label]) => <Button key={action} variant="outline" disabled={!!busy || !!jobId} onClick={() => run(action)}>{busy === action ? "Working…" : label}</Button>)}</div>
    <div className="flex flex-wrap items-end gap-2 rounded border border-border p-3">
      {people.length ? <label className="text-sm">Create a lead for
        <select aria-label="Person for the lead" value={personId} onChange={e => setPersonId(e.target.value)} className="ml-2 rounded border border-border bg-surface p-1.5 text-sm">
          {people.map(p => <option key={p.personId} value={p.personId}>{p.name} — {p.title}{p.likelyDecisionMaker ? " (likely decision maker, from title)" : ""}</option>)}
        </select></label> : <p className="text-sm text-secondary">No people found at this company yet. Use Find people, then choose who the lead is for.</p>}
      <Button variant="outline" disabled={!!busy || !!jobId || !personId} onClick={() => run("crm")}>{busy === "crm" ? "Working…" : "Add to CRM"}</Button>
      <p className="w-full text-xs text-secondary">The opportunity&apos;s sources become the lead&apos;s signals, and the lead is scored against your primary ICP.</p>
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}</div>;
}
