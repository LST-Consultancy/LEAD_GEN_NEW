"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api/client";

type Person = { name: string; title: string; linkedinUrl: string | null; city: string | null };

/** Corrects the person's name, title, LinkedIn and city. Only changed fields are sent. */
export function EditLeadDetailsButton({ leadId, person }: { leadId: string; person: Person }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(person);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const set = (k: keyof Person) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const body: Record<string, string | null> = {};
    if (form.name.trim() !== person.name) body.fullName = form.name.trim();
    if (form.title.trim() && form.title.trim() !== person.title) body.title = form.title.trim();
    if ((form.linkedinUrl ?? "").trim() !== (person.linkedinUrl ?? "")) body.linkedinUrl = (form.linkedinUrl ?? "").trim();
    if ((form.city ?? "").trim() !== (person.city ?? "")) body.city = (form.city ?? "").trim();
    if (Object.keys(body).length === 0) { setOpen(false); return; }
    setPending(true); setError("");
    try {
      await api.patch(`/api/leads/${leadId}/details`, body);
      toast.success("Details updated", { description: body.title ? "The score is being recomputed for the new title." : undefined });
      setOpen(false); router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not saved. Nothing was changed.");
    } finally { setPending(false); }
  }

  return (
    <>
      <Button variant="ghost" size="xs" aria-label="Edit details" onClick={() => { setForm(person); setError(""); setOpen(true); }}><Pencil /></Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit details</DialogTitle>
            <DialogDescription>Correct what we have on file. A move to a different company is a job change, not an edit, so company isn&apos;t changed here.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Name" htmlFor="ed-name" required><Input id="ed-name" value={form.name} onChange={set("name")} maxLength={160} /></Field>
            <Field label="Title" htmlFor="ed-title" hint="Decision-maker status is re-derived from this."><Input id="ed-title" value={form.title} onChange={set("title")} maxLength={160} /></Field>
            <Field label="LinkedIn profile" htmlFor="ed-linkedin"><Input id="ed-linkedin" value={form.linkedinUrl ?? ""} onChange={set("linkedinUrl")} placeholder="https://www.linkedin.com/in/…" /></Field>
            <Field label="City" htmlFor="ed-city"><Input id="ed-city" value={form.city ?? ""} onChange={set("city")} maxLength={120} /></Field>
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" size="sm" loading={pending} disabled={form.name.trim().length < 2} onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
