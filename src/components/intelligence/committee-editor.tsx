"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { COMMITTEE_ROLES, type CommitteeRole } from "@/lib/accounts/committee";
import { COMMITTEE_ROLE_LABEL } from "@/lib/vocab";
import type { getCommittee } from "@/lib/services/committee";

type Committee = Awaited<ReturnType<typeof getCommittee>>;
const select = "rounded border border-border bg-surface px-1.5 py-0.5 text-2xs";

/** Map the buying committee: confirm suggestions, change roles, see which roles are still uncovered. */
export function CommitteeEditor({ companyId, initial, canEdit }: { companyId: string; initial: Committee; canEdit: boolean }) {
  const router = useRouter();
  const [data, setData] = useState(initial); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const reload = async () => { setData(await api.get<Committee>(`/api/accounts/${companyId}/committee`)); router.refresh(); };
  async function set(personId: string, role: CommitteeRole, influence = 50, sentiment: string | null = null) {
    setBusy(true); setMessage("");
    try { await api.put(`/api/accounts/${companyId}/committee`, { personId, role, influence, sentiment }); await reload(); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  async function remove(personId: string, name: string) {
    if (!window.confirm(`Take ${name} off the committee? Their person record stays; the change is kept in history.`)) return;
    setBusy(true); try { await api.del(`/api/accounts/${companyId}/committee?personId=${personId}`); await reload(); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not remove."); } finally { setBusy(false); }
  }
  const c = data.coverage;
  return <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
    <div><h2 className="text-sm font-semibold text-primary">Buying committee</h2>
      <p className="mt-0.5 text-2xs text-secondary">{c.covered.length ? `Covered: ${c.covered.map(r => COMMITTEE_ROLE_LABEL[r]).join(", ")}. ` : ""}{c.missing.length ? `Nobody confirmed for: ${c.missing.map(r => COMMITTEE_ROLE_LABEL[r]).join(", ")}.` : "Every key role has someone confirmed."}{c.singleThreaded ? " Single-threaded: one confirmed contact or none — a deal here rests on one person." : ""}{c.unconfirmed ? ` ${c.unconfirmed} suggested, not yet confirmed.` : ""}</p></div>
    {message && <p role="alert" className="text-2xs text-danger-text">{message}</p>}
    {data.members.length > 0 && <ul className="divide-y divide-border">{data.members.map(m => <li key={m.personId} className="flex min-w-0 flex-wrap items-center gap-2 py-1.5 text-xs">
      <span className="min-w-0 flex-1 break-words"><span className="font-medium text-primary">{m.name}</span>{m.title ? <span className="text-secondary"> · {m.title}</span> : null}</span>
      {!m.confirmed && <Badge variant="warning" size="sm">Suggested</Badge>}
      {canEdit ? <>
        <select aria-label={`Role for ${m.name}`} className={select} value={m.role} disabled={busy} onChange={e => void set(m.personId, e.target.value as CommitteeRole, m.influence, m.sentiment)}>{COMMITTEE_ROLES.map(r => <option key={r} value={r}>{COMMITTEE_ROLE_LABEL[r]}</option>)}</select>
        <select aria-label={`Sentiment for ${m.name}`} className={select} value={m.sentiment ?? ""} disabled={busy} onChange={e => void set(m.personId, m.role as CommitteeRole, m.influence, e.target.value || null)}><option value="">Sentiment unknown</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></select>
        {!m.confirmed && <Button size="sm" variant="outline" disabled={busy} onClick={() => void set(m.personId, m.role as CommitteeRole, m.influence, m.sentiment)}>Confirm</Button>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(m.personId, m.name)}>Remove</Button>
      </> : <Badge variant="neutral" size="sm">{COMMITTEE_ROLE_LABEL[m.role]}</Badge>}
    </li>)}</ul>}
    {canEdit && data.suggestions.length > 0 && <div><p className="text-2xs font-medium text-secondary">People at this account not yet on the committee</p>
      <ul className="mt-1 space-y-1">{data.suggestions.map(s => <li key={s.personId} className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 break-words">{s.name}{s.title ? <span className="text-secondary"> · {s.title}</span> : null}{s.association === "uncertain" ? <span className="text-secondary"> · association uncertain</span> : null}<span className="block text-2xs text-muted">{s.basis}</span></span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void set(s.personId, s.role as CommitteeRole)}>Add as {COMMITTEE_ROLE_LABEL[s.role]}</Button>
      </li>)}</ul>
      <p className="mt-1 text-2xs text-muted">Suggested roles come from job titles only. Champions and blockers come from conversations, so set those yourself.</p></div>}
    {!data.members.length && !data.suggestions.length && <p className="text-2xs text-secondary">Nobody is recorded at this account yet. Find people from one of its opportunities, or look someone up in Lead Lens.</p>}
  </section>;
}
