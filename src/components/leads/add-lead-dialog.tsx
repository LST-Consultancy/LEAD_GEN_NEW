"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api/client";

type ImportResult = { imported: number; leadIds: string[]; skipped: { reason: string; existingLeadId?: string }[]; note: string };
const EMPTY = { fullName: "", companyName: "", title: "", email: "", phone: "", linkedinUrl: "", domain: "", city: "", note: "", sourceLabel: "" };
type Form = typeof EMPTY;

/** Field problems the server would also reject, caught before the round trip. */
function problems(f: Form): Partial<Record<keyof Form, string>> {
  const p: Partial<Record<keyof Form, string>> = {};
  if (f.fullName.trim().length < 2) p.fullName = "Their full name, at least two characters.";
  if (!f.companyName.trim()) p.companyName = "Which company they work at.";
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) p.email = "That isn't an email address.";
  if (f.linkedinUrl && !/^https?:\/\/\S+$/.test(f.linkedinUrl.trim())) p.linkedinUrl = "Paste the full profile URL, starting https://";
  if (f.phone && !/^[+\d][\d\s()-]{5,31}$/.test(f.phone.trim())) p.phone = "Digits, spaces and + only.";
  return p;
}

/**
 * One lead by hand. It goes through the same import service as a pasted list,
 * so it gets the same duplicate check, attribution and scoring as any other
 * lead — never a second-class record.
 */
export function AddLeadButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [touched, setTouched] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<React.ReactNode>(null);
  const issues = problems(form);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const show = (k: keyof Form) => (touched ? issues[k] : undefined);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(issues).length) return;
    setPending(true); setError(null);
    const row = Object.fromEntries(Object.entries(form).filter(([k, v]) => k !== "sourceLabel" && v.trim()).map(([k, v]) => [k, v.trim()]));
    try {
      const r = await api.post<ImportResult>("/api/find/import", { rows: [row], sourceLabel: form.sourceLabel.trim() || "Added by hand", assignToMe: true });
      if (r.imported === 1) {
        toast.success(`${form.fullName.trim()} added`, { description: "Scoring against your ICP now.", action: { label: "Open", onClick: () => router.push(`/leads/${r.leadIds[0]}`) } });
        setOpen(false); setForm(EMPTY); setTouched(false); router.refresh();
      } else {
        const dup = r.skipped[0];
        setError(<>{dup?.reason ?? "That wasn't added."} {dup?.existingLeadId ? <Link className="underline" href={`/leads/${dup.existingLeadId}`}>Open the existing lead</Link> : null}</>);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "no_icp") setError(<>{err.message} <Link className="underline" href="/settings/icp">Set up your ICP</Link></>);
      else setError(err instanceof ApiError ? err.message : "Not added. Nothing was changed.");
    } finally { setPending(false); }
  }

  return (
    <>
      <Button variant="secondary" size="md" onClick={() => setOpen(true)}><UserPlus />Add lead</Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <form onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>Add a lead</DialogTitle>
              <DialogDescription>
                Contacts you enter are yours, so they are not locked and cost no points. For a list, use{" "}
                <Link href="/find-leads" className="underline">Find leads → Import</Link>.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" htmlFor="al-name" required error={show("fullName")}><Input id="al-name" value={form.fullName} onChange={set("fullName")} maxLength={160} autoFocus /></Field>
              <Field label="Company" htmlFor="al-company" required error={show("companyName")}><Input id="al-company" value={form.companyName} onChange={set("companyName")} maxLength={200} /></Field>
              <Field label="Title" htmlFor="al-title"><Input id="al-title" value={form.title} onChange={set("title")} maxLength={160} /></Field>
              <Field label="Company website" htmlFor="al-domain" hint="Matches an existing company first."><Input id="al-domain" value={form.domain} onChange={set("domain")} placeholder="acme.in" maxLength={200} /></Field>
              <Field label="Work email" htmlFor="al-email" error={show("email")}><Input id="al-email" type="email" value={form.email} onChange={set("email")} /></Field>
              <Field label="Phone" htmlFor="al-phone" error={show("phone")}><Input id="al-phone" value={form.phone} onChange={set("phone")} maxLength={32} /></Field>
              <Field label="LinkedIn profile" htmlFor="al-linkedin" error={show("linkedinUrl")}><Input id="al-linkedin" value={form.linkedinUrl} onChange={set("linkedinUrl")} placeholder="https://www.linkedin.com/in/…" /></Field>
              <Field label="City" htmlFor="al-city"><Input id="al-city" value={form.city} onChange={set("city")} maxLength={120} /></Field>
              <Field label="Where they came from" htmlFor="al-source" hint="Kept as the lead's source." className="sm:col-span-2"><Input id="al-source" value={form.sourceLabel} onChange={set("sourceLabel")} placeholder="Met at the NASSCOM summit" maxLength={200} /></Field>
              <Field label="Note" htmlFor="al-note" className="sm:col-span-2"><Textarea id="al-note" rows={2} value={form.note} onChange={set("note")} maxLength={1000} /></Field>
              {error ? <p className="text-xs text-danger-text sm:col-span-2">{error}</p> : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" variant="primary" size="sm" loading={pending}>Add lead</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
