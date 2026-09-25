"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import type { listClaimable } from "@/lib/services/lead-claims";

type Data = Awaited<ReturnType<typeof listClaimable>>;

/** Unowned leads anyone who works leads can take. Contact details appear only once it is yours. */
export function ClaimQueue({ initial }: { initial: Data }) {
  const router = useRouter();
  const [data, setData] = React.useState(initial); const [busy, setBusy] = React.useState<string | null>(null); const [message, setMessage] = React.useState("");
  if (!data.total) return null;
  async function claim(id: string) {
    setBusy(id); setMessage("");
    try { await api.post(`/api/leads/${id}/claim`, {}); setData(d => ({ total: d.total - 1, leads: d.leads.filter(l => l.id !== id) })); setMessage("Claimed — it's in your leads now."); router.refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not claim it."); setData(await api.get<Data>("/api/leads/claimable")); } finally { setBusy(null); }
  }
  return <details className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
    <summary className="cursor-pointer font-medium text-primary">{data.total} unowned {data.total === 1 ? "lead" : "leads"} to claim</summary>
    <p className="mt-1 text-2xs text-muted">Nobody owns these yet. Claiming one makes it yours; contact details show once it is.</p>
    {message && <p role="status" className="mt-1">{message}</p>}
    <ul className="mt-2 divide-y divide-border">{data.leads.map(l => <li key={l.id} className="flex min-w-0 flex-wrap items-center gap-2 py-1.5">
      <span className="min-w-0 flex-1 break-words"><span className="font-medium text-primary">{l.name}</span>{l.title ? ` · ${l.title}` : ""} · {l.company.name}<span className="block text-2xs text-muted">Tier {l.tier} · {l.intent.toLowerCase()} · {l.surfacedReason}</span></span>
      <Button size="xs" variant="outline" loading={busy === l.id} disabled={busy !== null} onClick={() => void claim(l.id)}>Claim</Button>
    </li>)}</ul>
  </details>;
}
