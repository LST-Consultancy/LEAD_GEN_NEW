"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api/client";
import { formatRelative } from "@/lib/format";

type Hit = { id: string; name: string; company: string };
type EnrollResult = { enrolled: number; skipped: { leadId: string; name?: string; reason?: string; reasons?: string[] }[]; note: string };
type Enrollment = { id: string; state: string; currentStep: number; nextSendAt: string | null; stopReason: string | null; lead: { id: string; name: string; company: string } };

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Nothing was changed.");

/** Picks leads and enrols them; leads that cannot be contacted are reported, not silently dropped. */
export function EnrollLeadsButton({ sequenceId, sequenceName }: { sequenceId: string; sequenceName: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [picked, setPicked] = React.useState<Hit[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState<EnrollResult | null>(null);

  React.useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => { api.get<{ leads: Hit[] }>(`/api/leads?q=${encodeURIComponent(q.trim())}`).then((r) => setHits(r.leads), () => setHits([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function enroll() {
    setPending(true); setError("");
    try {
      const r = await api.post<EnrollResult>(`/api/sequences/${sequenceId}/enroll`, { leadIds: picked.map((p) => p.id) });
      setResult(r); router.refresh();
      if (r.skipped.length === 0) { toast.success(`${r.enrolled} enrolled`, { description: r.note }); close(); }
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }
  function close() { setOpen(false); setQ(""); setHits([]); setPicked([]); setResult(null); setError(""); }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><UserPlus />Enrol leads</Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : !pending && close())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enrol leads in {sequenceName}</DialogTitle>
            <DialogDescription>Each lead is checked against the do-not-contact list, their address and the sequence rules before joining. Nothing is sent from this dialog.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            {result ? (
              <div className="space-y-1 text-xs">
                <p className="text-primary">{result.note}</p>
                {result.skipped.length ? (
                  <ul className="max-h-40 space-y-0.5 overflow-auto rounded border border-border-subtle bg-surface-sunken p-2 text-2xs text-secondary">
                    {result.skipped.map((s) => <li key={s.leadId}>{s.name ?? picked.find((p) => p.id === s.leadId)?.name ?? "A lead"}: {s.reason ?? s.reasons?.join("; ") ?? "not enrolled"}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : (
              <>
                <Input aria-label="Find leads" placeholder="Search leads by name or company" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                {hits.length ? (
                  <ul className="max-h-40 overflow-auto rounded border border-border-subtle">
                    {hits.map((h) => {
                      const on = picked.some((p) => p.id === h.id);
                      return (
                        <li key={h.id}>
                          <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-surface-hover">
                            <input type="checkbox" checked={on} onChange={() => setPicked((xs) => (on ? xs.filter((x) => x.id !== h.id) : [...xs, h]))} />
                            {h.name} <span className="text-muted">· {h.company}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {picked.length ? <p className="text-2xs text-secondary">{picked.length} selected: {picked.map((p) => p.name).join(", ")}</p> : null}
              </>
            )}
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={close} disabled={pending}>{result ? "Close" : "Cancel"}</Button>
            {!result ? <Button variant="primary" size="sm" loading={pending} disabled={picked.length === 0} onClick={() => void enroll()}>Enrol {picked.length || ""}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Who is in the sequence now, with a way to take someone out. */
export function EnrollmentList({ sequenceId }: { sequenceId: string }) {
  const [rows, setRows] = React.useState<Enrollment[] | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(() => { api.get<{ enrollments: Enrollment[] }>(`/api/sequences/${sequenceId}/enroll`).then((r) => setRows(r.enrollments), (err) => setError(errorText(err))); }, [sequenceId]);
  React.useEffect(load, [load]);

  async function remove(e: Enrollment) {
    try { await api.del(`/api/sequences/${sequenceId}/enroll?leadId=${e.lead.id}`); toast.success(`${e.lead.name} taken out`, { description: "No further steps will go to them." }); load(); }
    catch (err) { toast.error("Couldn't unenrol", { description: errorText(err) }); }
  }

  if (error) return <p className="text-2xs text-danger-text">{error}</p>;
  if (rows === null) return <p className="text-2xs text-muted">Loading enrolments…</p>;
  if (rows.length === 0) return <p className="text-2xs text-muted">Nobody is enrolled yet.</p>;
  return (
    <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
      {rows.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate text-primary">{e.lead.name} <span className="text-muted">· {e.lead.company}</span></span>
          <Badge size="sm" variant={e.state === "active" ? "success" : "neutral"}>{e.state}</Badge>
          <span className="text-2xs text-muted">
            {e.state === "active" ? (e.nextSendAt ? `step ${e.currentStep + 1} ${formatRelative(e.nextSendAt)}` : `after step ${e.currentStep}`) : e.stopReason ?? ""}
          </span>
          {e.state === "active" ? <Button variant="ghost" size="xs" aria-label={`Unenrol ${e.lead.name}`} onClick={() => void remove(e)}><X /></Button> : null}
        </li>
      ))}
    </ul>
  );
}
