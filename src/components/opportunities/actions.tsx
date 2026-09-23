"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
export function OpportunityActions({ id }: { id: string }) {
  const router = useRouter(); const [jobId, setJobId] = useState<string | null>(null); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { if (!jobId) return; const timer = setInterval(async () => { try { const r = await api.get<{ state: string; error: string | null }>(`/api/opportunities/actions/${jobId}`); setMessage(r.error ?? r.state); if (["COMPLETED", "FAILED"].includes(r.state)) { setJobId(null); router.refresh(); } } catch { setMessage("Could not retrieve operation status. Check the job monitor."); } }, 2500); return () => clearInterval(timer); }, [jobId, router]);
  async function run(action: string) { setBusy(action); setMessage(""); try { const r = await api.post<{ note?: string; leadId?: string; jobId?: string }>(`/api/opportunities/${id}/${action}`, {}); if (r.jobId) setJobId(r.jobId); if (r.leadId) router.push(`/leads/${r.leadId}`); else { setMessage(r.note ?? "Research saved with source citations."); router.refresh(); } } catch (e) { setMessage(e instanceof Error ? e.message : "Operation failed."); } finally { setBusy(""); } }
  return <div className="space-y-3"><div className="flex flex-wrap gap-2">{[["research", "Research company"], ["enrich", "Find decision makers"], ["verify", "Verify emails"], ["crm", "Add to CRM"]].map(([action,label]) => <Button key={action} variant="outline" disabled={!!busy || !!jobId} onClick={() => run(action)}>{busy === action ? "Working…" : label}</Button>)}</div>{message && <p role="status" className="text-sm">{message}</p>}</div>;
}
