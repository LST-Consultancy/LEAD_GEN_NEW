"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageIcon, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api/client";

type Pkg = { name: string; unit: string; priceInr: string; inclusions: string };
type Study = { title: string; summary: string };
export type DefaultsValue = {
  taxRate: number; validityDays: number; terms: string | null; pricingNote: string | null; description: string | null;
  contactEmail: string | null; contactPhone: string | null; website: string | null; address: string | null; logoDataUrl: string | null;
  packages: { name: string; unit: string; priceInr: number; inclusions: string[] }[]; caseStudies: Study[]; saved: boolean;
};

const LOGO_MAX = 256 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Starting values for new proposals. Cancel restores what is saved; nothing
 * changes until Save, and saving never touches a proposal that already exists.
 */
export function ProposalDefaultsForm({ initial, canEdit }: { initial: DefaultsValue; canEdit: boolean }) {
  const router = useRouter();
  const fromInitial = React.useCallback(() => ({
    taxRate: String(initial.taxRate), validityDays: String(initial.validityDays), terms: initial.terms ?? "", pricingNote: initial.pricingNote ?? "",
    description: initial.description ?? "", contactEmail: initial.contactEmail ?? "", contactPhone: initial.contactPhone ?? "", website: initial.website ?? "",
    address: initial.address ?? "", logoDataUrl: initial.logoDataUrl ?? "",
    packages: initial.packages.map((p) => ({ name: p.name, unit: p.unit, priceInr: String(p.priceInr), inclusions: p.inclusions.join("\n") })) as Pkg[],
    caseStudies: initial.caseStudies as Study[],
  }), [initial]);
  const [form, setForm] = React.useState(fromInitial);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [logoError, setLogoError] = React.useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(fromInitial());
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function pickLogo(file: File | undefined) {
    setLogoError("");
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setLogoError("Use a PNG, JPEG or WebP image. SVG isn't accepted because it can carry script."); return; }
    if (file.size > LOGO_MAX) { setLogoError(`That file is ${Math.round(file.size / 1024)} KB; the limit is 256 KB.`); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logoDataUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function save() {
    setPending(true); setError("");
    try {
      await api.put("/api/proposal-defaults", {
        taxRate: Number(form.taxRate), validityDays: Number(form.validityDays), terms: form.terms, pricingNote: form.pricingNote,
        description: form.description, contactEmail: form.contactEmail, contactPhone: form.contactPhone, website: form.website, address: form.address,
        logoDataUrl: form.logoDataUrl,
        packages: form.packages.map((p) => ({ name: p.name.trim(), unit: p.unit.trim() || "package", priceInr: Number(p.priceInr), inclusions: p.inclusions.split("\n").map((x) => x.trim()).filter(Boolean) })),
        caseStudies: form.caseStudies.filter((c) => c.title.trim()),
      });
      toast.success("Defaults saved", { description: "New proposals start from these. Existing proposals are unchanged." });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not saved. Nothing was changed.");
    } finally { setPending(false); }
  }

  const setPkg = (i: number, k: keyof Pkg) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, packages: f.packages.map((p, j) => (j === i ? { ...p, [k]: e.target.value } : p)) }));
  const setStudy = (i: number, k: keyof Study) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, caseStudies: f.caseStudies.map((c, j) => (j === i ? { ...c, [k]: e.target.value } : c)) }));

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Defaults for new proposals</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">{initial.saved ? "New proposals start from these values." : "Not set yet — new proposals start at 18% tax and 30 days' validity."} Proposals already created keep their own figures.</p>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tax rate (%)" htmlFor="pd-tax"><Input id="pd-tax" inputMode="decimal" value={form.taxRate} onChange={set("taxRate")} className="tabular" /></Field>
            <Field label="Valid for (days)" htmlFor="pd-valid"><Input id="pd-valid" inputMode="numeric" value={form.validityDays} onChange={set("validityDays")} className="tabular" /></Field>
            <div className="space-y-1">
              <span className="text-xs font-medium text-primary">Logo</span>
              <div className="flex items-center gap-2">
                {/* A data URL from the file picker; next/image cannot optimise one. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {form.logoDataUrl ? <img src={form.logoDataUrl} alt="Logo preview" className="h-8 max-w-24 rounded border border-border object-contain" /> : <ImageIcon className="size-5 text-muted" />}
                <label className="cursor-pointer text-2xs text-brand-text hover:underline">
                  {form.logoDataUrl ? "Replace" : "Upload"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Logo file" onChange={(e) => pickLogo(e.target.files?.[0])} />
                </label>
                {form.logoDataUrl ? <button type="button" className="text-2xs text-muted hover:underline" onClick={() => setForm((f) => ({ ...f, logoDataUrl: "" }))}>Remove</button> : null}
              </div>
              <p className="text-2xs text-muted">PNG, JPEG or WebP, up to 256 KB.</p>
              {logoError ? <p className="text-2xs text-danger-text">{logoError}</p> : null}
            </div>
          </div>
          <Field label="About your company" htmlFor="pd-desc"><Textarea id="pd-desc" rows={2} value={form.description} onChange={set("description")} maxLength={2000} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact email" htmlFor="pd-email"><Input id="pd-email" type="email" value={form.contactEmail} onChange={set("contactEmail")} /></Field>
            <Field label="Contact phone" htmlFor="pd-phone"><Input id="pd-phone" value={form.contactPhone} onChange={set("contactPhone")} maxLength={40} /></Field>
            <Field label="Website" htmlFor="pd-web"><Input id="pd-web" value={form.website} onChange={set("website")} placeholder="https://" /></Field>
            <Field label="Address" htmlFor="pd-addr"><Input id="pd-addr" value={form.address} onChange={set("address")} maxLength={500} /></Field>
          </div>
          <Field label="Standard terms" htmlFor="pd-terms"><Textarea id="pd-terms" rows={3} value={form.terms} onChange={set("terms")} maxLength={10000} /></Field>
          <Field label="Pricing note" htmlFor="pd-pnote" hint="Shown to your team in the editor, not to the customer."><Textarea id="pd-pnote" rows={2} value={form.pricingNote} onChange={set("pricingNote")} maxLength={2000} /></Field>

          <div className="space-y-2">
            <p className="text-xs font-medium text-primary">Packages <span className="font-normal text-muted">— one click adds a package to a proposal as a line item, at this price.</span></p>
            {form.packages.map((p, i) => (
              <div key={i} className="grid gap-1.5 rounded-md border border-border-subtle p-2 sm:grid-cols-[1fr_6rem_8rem_auto]">
                <Input aria-label={`Package ${i + 1} name`} value={p.name} onChange={setPkg(i, "name")} placeholder="NetSuite starter" maxLength={120} />
                <Input aria-label={`Package ${i + 1} unit`} value={p.unit} onChange={setPkg(i, "unit")} maxLength={30} />
                <Input aria-label={`Package ${i + 1} price`} inputMode="decimal" value={p.priceInr} onChange={setPkg(i, "priceInr")} placeholder="₹" className="tabular" />
                <Button variant="ghost" size="sm" aria-label={`Remove package ${i + 1}`} onClick={() => setForm((f) => ({ ...f, packages: f.packages.filter((_, j) => j !== i) }))}><Trash2 /></Button>
                <Textarea aria-label={`Package ${i + 1} inclusions`} rows={2} value={p.inclusions} onChange={setPkg(i, "inclusions")} placeholder="One inclusion per line" className="sm:col-span-4" />
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setForm((f) => ({ ...f, packages: [...f.packages, { name: "", unit: "package", priceInr: "", inclusions: "" }] }))}><Plus />Add package</Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-primary">Case studies</p>
            {form.caseStudies.map((c, i) => (
              <div key={i} className="space-y-1.5 rounded-md border border-border-subtle p-2">
                <div className="flex gap-1.5">
                  <Input aria-label={`Case study ${i + 1} title`} value={c.title} onChange={setStudy(i, "title")} maxLength={160} />
                  <Button variant="ghost" size="sm" aria-label={`Remove case study ${i + 1}`} onClick={() => setForm((f) => ({ ...f, caseStudies: f.caseStudies.filter((_, j) => j !== i) }))}><Trash2 /></Button>
                </div>
                <Textarea aria-label={`Case study ${i + 1} summary`} rows={2} value={c.summary} onChange={setStudy(i, "summary")} maxLength={2000} />
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setForm((f) => ({ ...f, caseStudies: [...f.caseStudies, { title: "", summary: "" }] }))}><Plus />Add case study</Button>
          </div>
        </fieldset>
        {error ? <p role="alert" className="mt-3 text-xs text-danger-text">{error}</p> : null}
        {canEdit ? (
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={!dirty || pending} onClick={() => { setForm(fromInitial()); setError(""); setLogoError(""); }}>Cancel</Button>
            <Button variant="primary" size="sm" loading={pending} disabled={!dirty} onClick={() => void save()}>Save defaults</Button>
          </div>
        ) : <p className="mt-3 text-2xs text-muted">Changing these needs pipeline configuration access.</p>}
      </CardContent>
    </Card>
  );
}
