"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api/client";

type Draft = { id?: string; name: string; domain: string | null; aliases: string[]; notes: string | null };
const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Nothing was changed.");

/** Add or edit a competitor. Aliases are what signal matching looks for. */
export function CompetitorEditorButton({ initial, label }: { initial?: Draft; label: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(initial?.name ?? "");
  const [domain, setDomain] = React.useState(initial?.domain ?? "");
  const [aliases, setAliases] = React.useState((initial?.aliases ?? []).join(", "));
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  async function save() {
    setPending(true); setError("");
    const body = { name: name.trim(), domain: domain.trim(), aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean), notes: notes.trim() || undefined };
    try {
      if (initial?.id) await api.put(`/api/competitors/${initial.id}`, body);
      else await api.post("/api/competitors", body);
      toast.success(initial?.id ? "Competitor saved" : `${body.name} is now tracked`, { description: "Signals that mention it, or an alias, are matched here." });
      setOpen(false); router.refresh();
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }

  return (
    <>
      <Button variant={initial ? "ghost" : "primary"} size="sm" onClick={() => { setError(""); setOpen(true); }}>{initial ? null : <Plus />}{label}</Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{initial?.id ? "Edit competitor" : "Track a competitor"}</DialogTitle>
            <DialogDescription>Matched against the text of every signal by name and alias.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Name" htmlFor="cp-name" required><Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
            <Field label="Other names it goes by" htmlFor="cp-alias" hint="Comma-separated, e.g. Meridian SI, Meridian."><Input id="cp-alias" value={aliases} onChange={(e) => setAliases(e.target.value)} /></Field>
            <Field label="Website domain" htmlFor="cp-domain"><Input id="cp-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="meridiansi.com" /></Field>
            <Field label="Where you win and lose against them" htmlFor="cp-notes"><Textarea id="cp-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" size="sm" loading={pending} disabled={name.trim().length < 2} onClick={() => void save()}>{initial?.id ? "Save" : "Track"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RemoveCompetitorButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  async function remove() {
    setPending(true);
    try { await api.del(`/api/competitors/${id}`); toast.success(`${name} removed`, { description: "It's in the recycle bin if you need it back." }); router.refresh(); }
    catch (err) { toast.error("Not removed", { description: errorText(err) }); } finally { setPending(false); }
  }
  return <Button variant="ghost" size="xs" aria-label={`Stop tracking ${name}`} loading={pending} onClick={() => void remove()}><Trash2 /></Button>;
}
