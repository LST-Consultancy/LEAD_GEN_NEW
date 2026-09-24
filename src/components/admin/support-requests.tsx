"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api/client";
import { formatAge } from "@/lib/format";

type Entry = { at: string; by: string; status: string; note: string | null };
export type SupportRequestRow = { id: string; reference: string; subject: string; message: string; status: string; history: Entry[]; createdAt: string; author: string; mine: boolean };
const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Nothing was sent.");
const TONE: Record<string, "warning" | "success" | "neutral"> = { open: "warning", answered: "success", closed: "neutral" };

export function SupportRequests({ initial, isAdmin }: { initial: SupportRequestRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true); setError("");
    try {
      const r = await api.post<{ reference: string }>("/api/support-requests", { subject, message });
      toast.success(`Request ${r.reference} opened`, { description: "Your workspace administrators can see it now. Quote the reference if you follow up." });
      setSubject(""); setMessage(""); router.refresh();
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2" noValidate>
        <Field label="Subject" htmlFor="sr-subject"><Input id="sr-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} /></Field>
        <Field label="What happened" htmlFor="sr-message" hint="What you expected, what happened instead, and roughly when."><Textarea id="sr-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} /></Field>
        {error ? <p className="text-xs text-danger-text">{error}</p> : null}
        <div className="flex items-center justify-end gap-2">
          <p className="mr-auto text-2xs text-muted">Goes to this workspace&apos;s administrators, with the current system checks attached. It is not sent outside the workspace.</p>
          <Button type="submit" variant="primary" size="sm" loading={pending} disabled={subject.trim().length < 4 || message.trim().length < 10}>Open request</Button>
        </div>
      </form>

      {initial.length ? (
        <ul className="space-y-2">
          {initial.map((r) => <RequestItem key={r.id} row={r} isAdmin={isAdmin} />)}
        </ul>
      ) : <p className="text-2xs text-muted">{isAdmin ? "No requests from anyone in this workspace." : "You haven't opened any requests."}</p>}
    </div>
  );
}

function RequestItem({ row, isAdmin }: { row: SupportRequestRow; isAdmin: boolean }) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  async function update(status: "answered" | "closed" | "open") {
    setPending(true);
    try {
      await api.patch(`/api/support-requests/${row.id}`, { status, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(status === "answered" ? "Answer recorded" : status === "closed" ? "Request closed" : "Request reopened");
      setNote(""); router.refresh();
    } catch (err) { toast.error("Not updated", { description: errorText(err) }); } finally { setPending(false); }
  }
  return (
    <li className="space-y-1.5 rounded-md border border-border-subtle p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-2xs text-muted">{row.reference}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-primary">{row.subject}</span>
        <Badge size="sm" variant={TONE[row.status] ?? "neutral"}>{row.status}</Badge>
      </div>
      <p className="whitespace-pre-wrap text-secondary">{row.message}</p>
      <ol className="space-y-0.5 border-l border-border-subtle pl-2 text-2xs text-muted">
        {row.history.map((h, i) => <li key={i}>{h.status} by {h.by} {formatAge(h.at)}{h.note ? <> — <span className="text-secondary">{h.note}</span></> : null}</li>)}
      </ol>
      {(isAdmin || row.mine) && row.status !== "closed" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input aria-label={`Reply to ${row.reference}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={isAdmin ? "Answer" : "Add a note"} maxLength={2000} className="h-7 min-w-0 flex-1 text-2xs" />
          {isAdmin ? <Button size="xs" variant="secondary" loading={pending} disabled={!note.trim()} onClick={() => void update("answered")}>Answer</Button> : null}
          <Button size="xs" variant="ghost" disabled={pending} onClick={() => void update("closed")}>Close</Button>
        </div>
      ) : row.status === "closed" && row.mine ? <Button size="xs" variant="ghost" disabled={pending} onClick={() => void update("open")}>Reopen</Button> : null}
    </li>
  );
}
