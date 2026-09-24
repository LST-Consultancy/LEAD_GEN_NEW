"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Eye, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api/client";
import { computeTotals, lineAmount } from "@/lib/proposals/money";
import { formatInr } from "@/lib/format";

type Item = { name: string; description: string; quantity: string; unit: string; unitPriceInr: string };
type Section = { key: string; title: string; body: string };
export type EditorInitial = {
  id?: string;
  state?: string;
  publicPath?: string | null;
  title: string;
  company: { id: string; name: string } | null;
  leadId: string;
  dealId: string;
  taxRate: number;
  validUntil: string;
  terms: string;
  sections: Section[];
  items: { name: string; description?: string | null; quantity: number; unit: string; unitPriceInr: number }[];
};

const blankItem = (): Item => ({ name: "", description: "", quantity: "1", unit: "item", unitPriceInr: "" });
const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

/**
 * One editor for new and existing proposals. Totals are computed with the same
 * paise arithmetic the server stores, so the figure shown here is the figure
 * saved. Saving always leaves the proposal a draft; making it live is a
 * separate, explicit step, and neither sends an email.
 */
export function ProposalEditor({ initial, leads, deals, normsHint, packages = [], pricingNote = null }: {
  initial: EditorInitial;
  leads: { id: string; name: string }[];
  deals: { id: string; title: string }[];
  normsHint: string | null;
  packages?: { name: string; unit: string; priceInr: number; inclusions: string[] }[];
  pricingNote?: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState(initial.title);
  const [company, setCompany] = React.useState(initial.company);
  const [leadId, setLeadId] = React.useState(initial.leadId);
  const [dealId, setDealId] = React.useState(initial.dealId);
  const [taxRate, setTaxRate] = React.useState(String(initial.taxRate));
  const [validUntil, setValidUntil] = React.useState(initial.validUntil);
  const [terms, setTerms] = React.useState(initial.terms);
  const [sections, setSections] = React.useState<Section[]>(initial.sections);
  const [items, setItems] = React.useState<Item[]>(initial.items.length ? initial.items.map((i) => ({ name: i.name, description: i.description ?? "", quantity: String(i.quantity), unit: i.unit, unitPriceInr: String(i.unitPriceInr) })) : [blankItem()]);
  const [preview, setPreview] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [companyQuery, setCompanyQuery] = React.useState("");
  const [companyHits, setCompanyHits] = React.useState<{ id: string; name: string }[]>([]);

  const accepted = initial.state === "ACCEPTED";
  const priced = items.map((i) => ({ name: i.name, quantity: num(i.quantity), unitPriceInr: num(i.unitPriceInr) }));
  const itemsValid = priced.length > 0 && priced.every((i) => i.name.trim() && Number.isFinite(i.quantity) && Number.isFinite(i.unitPriceInr));
  const tax = num(taxRate);
  const taxValid = Number.isFinite(tax) && tax >= 0 && tax <= 50;
  const totals = itemsValid && taxValid ? computeTotals(priced, tax) : null;
  const canSave = !accepted && title.trim().length >= 2 && company && itemsValid && taxValid;

  React.useEffect(() => {
    if (company || companyQuery.trim().length < 2) { setCompanyHits([]); return; }
    const t = setTimeout(() => { api.get<{ accounts: { id: string; name: string }[] }>(`/api/accounts?q=${encodeURIComponent(companyQuery.trim())}`).then((r) => setCompanyHits(r.accounts), () => setCompanyHits([])); }, 250);
    return () => clearTimeout(t);
  }, [companyQuery, company]);

  const setItem = (i: number, k: keyof Item) => (e: React.ChangeEvent<HTMLInputElement>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
  const setSection = (i: number, k: "title" | "body") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setSections((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));

  function payload() {
    return {
      title: title.trim(), companyId: company!.id,
      leadId: leadId || undefined, dealId: dealId || undefined,
      taxRate: tax, terms: terms.trim() || undefined,
      validUntil: validUntil ? new Date(`${validUntil}T12:00:00`).toISOString() : undefined,
      sections: sections.filter((s) => s.title.trim()).map((s) => ({ key: s.key, title: s.title.trim(), body: s.body.trim() })),
      items: items.map((i) => ({ name: i.name.trim(), description: i.description.trim() || undefined, quantity: num(i.quantity), unit: i.unit.trim() || "item", unitPriceInr: num(i.unitPriceInr) })),
    };
  }

  async function save(): Promise<string | null> {
    setPending("save"); setError("");
    try {
      if (initial.id) {
        const r = await api.put<{ note: string }>(`/api/proposals/${initial.id}`, payload());
        toast.success("Saved", { description: r.note });
        router.refresh();
        return initial.id;
      }
      const r = await api.post<{ proposal: { id: string }; note: string }>("/api/proposals", payload());
      toast.success("Draft saved", { description: r.note });
      router.push(`/proposals/${r.proposal.id}/edit`);
      return r.proposal.id;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not saved. Nothing was changed.");
      return null;
    } finally { setPending(null); }
  }

  async function makeLive() {
    const id = await save();
    if (!id) return;
    setPending("live");
    try {
      const r = await api.post<{ note: string }>(`/api/proposals/${id}/send`, {});
      toast.success("Live", { description: r.note });
      router.push("/proposals");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "It was saved, but not made live.");
    } finally { setPending(null); }
  }

  async function draftNarrative() {
    if (!initial.id) return;
    setPending("ai"); setError("");
    try {
      const r = await api.post<{ sections?: Section[]; note?: string }>(`/api/proposals/${initial.id}/draft`, {});
      if (r.sections?.length) {
        setSections(r.sections);
        toast.success("Sections drafted", { description: "Read them before saving. Prices and totals were not touched." });
      } else toast.message("Nothing drafted", { description: r.note });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The draft didn't come back. Your sections are unchanged.");
    } finally { setPending(null); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="xs" asChild><Link href="/proposals"><ArrowLeft />Proposals</Link></Button>
        <h1 className="text-lg font-semibold text-primary">{initial.id ? "Edit proposal" : "New proposal"}</h1>
        <span className="ml-auto flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setPreview((p) => !p)}><Eye />{preview ? "Back to editing" : "Preview"}</Button>
        </span>
      </div>

      {accepted ? <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-secondary">Accepted proposals can&apos;t be edited — that would rewrite what the customer agreed to. Create a new proposal instead.</p> : null}
      {initial.publicPath && !accepted ? <p className="rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-xs text-warning-text">This proposal is live. Saving changes what anyone holding the link sees, immediately.</p> : null}

      {preview ? (
        <Card>
          <CardContent className="space-y-4 py-5">
            <p className="text-2xs uppercase tracking-wider text-muted">Preview — how the customer will see it</p>
            <h2 className="text-xl font-semibold text-primary">{title || "Untitled proposal"}</h2>
            <p className="text-xs text-secondary">Prepared for {company?.name ?? "—"}{validUntil ? ` · valid until ${validUntil}` : ""}</p>
            {sections.filter((s) => s.title.trim()).map((s) => (
              <section key={s.key} className="space-y-1"><h3 className="text-sm font-semibold text-primary">{s.title}</h3><p className="whitespace-pre-wrap text-xs leading-relaxed text-secondary">{s.body}</p></section>
            ))}
            <Totals items={items} totals={totals} tax={tax} />
            {terms.trim() ? <section className="space-y-1"><h3 className="text-sm font-semibold text-primary">Terms</h3><p className="whitespace-pre-wrap text-xs text-secondary">{terms}</p></section> : null}
          </CardContent>
        </Card>
      ) : (
        <fieldset disabled={accepted} className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Who it&apos;s for</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Title" htmlFor="pe-title" required className="sm:col-span-2"><Input id="pe-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
              <Field label="Company" htmlFor="pe-company" required>
                {company ? (
                  <div className="flex items-center gap-2 text-xs"><span className="text-primary">{company.name}</span>{!initial.id ? <button type="button" className="text-2xs text-muted underline" onClick={() => { setCompany(null); setLeadId(""); setDealId(""); }}>change</button> : null}</div>
                ) : (
                  <div className="relative">
                    <Input id="pe-company" value={companyQuery} onChange={(e) => setCompanyQuery(e.target.value)} placeholder="Search your accounts" autoComplete="off" />
                    {companyHits.length ? (
                      <ul className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-raised">
                        {companyHits.map((c) => <li key={c.id}><button type="button" className="w-full px-2 py-1.5 text-left text-xs hover:bg-surface-hover" onClick={() => { setCompany(c); setCompanyQuery(""); router.replace(`/proposals/new?companyId=${c.id}`); }}>{c.name}</button></li>)}
                      </ul>
                    ) : null}
                  </div>
                )}
              </Field>
              <Field label="Lead" htmlFor="pe-lead">
                <select id="pe-lead" value={leadId} onChange={(e) => setLeadId(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs" disabled={!company}>
                  <option value="">None</option>
                  {leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="Deal" htmlFor="pe-deal">
                <select id="pe-deal" value={dealId} onChange={(e) => setDealId(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs" disabled={!company}>
                  <option value="">None</option>
                  {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </Field>
              <Field label="Valid until" htmlFor="pe-valid" hint="The whole of that day, in your workspace's timezone."><Input id="pe-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sections</CardTitle>
              {initial.id ? <Button variant="ghost" size="sm" loading={pending === "ai"} onClick={() => void draftNarrative()}><Sparkles />Draft with AI</Button> : <span className="text-2xs text-muted">Save once to draft sections with AI.</span>}
            </CardHeader>
            <CardContent className="space-y-3">
              {sections.map((s, i) => (
                <div key={s.key} className="space-y-1.5 rounded-md border border-border-subtle p-2.5">
                  <div className="flex gap-1.5">
                    <Input aria-label={`Section ${i + 1} title`} value={s.title} onChange={setSection(i, "title")} placeholder="Scope of work" maxLength={200} />
                    <Button variant="ghost" size="sm" aria-label={`Remove section ${i + 1}`} onClick={() => setSections((xs) => xs.filter((_, j) => j !== i))}><Trash2 /></Button>
                  </div>
                  <Textarea aria-label={`Section ${i + 1} body`} rows={4} value={s.body} onChange={setSection(i, "body")} maxLength={20000} />
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setSections((xs) => [...xs, { key: `s${Date.now().toString(36)}`, title: "", body: "" }])}><Plus />Add section</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-[4rem_4.5rem_1fr_auto] items-start gap-1.5 sm:grid-cols-[1fr_4.5rem_4.5rem_7rem_auto]">
                  <div className="col-span-4 min-w-0 space-y-1 sm:col-span-1">
                    <Input aria-label={`Line ${i + 1} name`} value={it.name} onChange={setItem(i, "name")} placeholder="Implementation" maxLength={200} />
                    <Input aria-label={`Line ${i + 1} description`} value={it.description} onChange={setItem(i, "description")} placeholder="Description (optional)" maxLength={1000} className="text-2xs" />
                  </div>
                  <Input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={it.quantity} onChange={setItem(i, "quantity")} className="tabular" />
                  <Input aria-label={`Line ${i + 1} unit`} value={it.unit} onChange={setItem(i, "unit")} maxLength={30} />
                  <Input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" value={it.unitPriceInr} onChange={setItem(i, "unitPriceInr")} placeholder="₹" className="tabular" />
                  <Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} disabled={items.length === 1} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-1.5">
                <Button variant="secondary" size="sm" onClick={() => setItems((xs) => [...xs, blankItem()])}><Plus />Add line</Button>
                {packages.map((p) => (
                  <Button key={p.name} variant="ghost" size="sm" onClick={() => setItems((xs) => [...xs.filter((x) => x.name.trim() || x.unitPriceInr.trim()), { name: p.name, description: p.inclusions.join("; "), quantity: "1", unit: p.unit, unitPriceInr: String(p.priceInr) }])}>
                    <Plus />{p.name}
                  </Button>
                ))}
              </div>
              {pricingNote ? <p className="rounded bg-surface-sunken px-2 py-1 text-2xs text-secondary">Team pricing note: {pricingNote}</p> : null}
              <div className="grid gap-3 border-t border-border-subtle pt-3 sm:grid-cols-[10rem_1fr]">
                <Field label="Tax rate (%)" htmlFor="pe-tax" hint={normsHint ?? undefined}><Input id="pe-tax" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="tabular" /></Field>
                <Totals items={items} totals={totals} tax={tax} />
              </div>
              {!itemsValid ? <p className="text-2xs text-warning-text">Every line needs a name, a quantity and a unit price.</p> : null}
              {!taxValid ? <p className="text-2xs text-warning-text">Tax rate must be between 0 and 50.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Terms</CardTitle></CardHeader>
            <CardContent><Textarea aria-label="Terms" rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={10000} placeholder="Payment 50% on signing, 50% on go-live." /></CardContent>
          </Card>
        </fieldset>
      )}

      {error ? <p role="alert" className="text-xs text-danger-text">{error}</p> : null}
      {!accepted ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-2xs text-muted">Saving keeps it a draft. Nothing is emailed from here.</p>
          <Button variant="secondary" size="sm" loading={pending === "save"} disabled={!canSave || pending !== null} onClick={() => void save()}>Save draft</Button>
          {!initial.publicPath ? <Button variant="primary" size="sm" loading={pending === "live"} disabled={!canSave || pending !== null} onClick={() => void makeLive()}>Save and make live</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

function Totals({ items, totals, tax }: { items: Item[]; totals: ReturnType<typeof computeTotals> | null; tax: number }) {
  return (
    <div className="space-y-1 text-xs">
      <table className="w-full">
        <tbody>
          {items.filter((i) => i.name.trim()).map((i, k) => {
            const q = num(i.quantity); const p = num(i.unitPriceInr);
            return (
              <tr key={k} className="border-b border-border-subtle">
                <td className="py-1 text-primary">{i.name}</td>
                <td className="py-1 text-right tabular text-muted">{Number.isFinite(q) ? q : "—"} {i.unit}</td>
                <td className="py-1 text-right tabular text-primary">{Number.isFinite(q) && Number.isFinite(p) ? formatInr(lineAmount({ name: i.name, quantity: q, unitPriceInr: p }), { paise: true }) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {totals ? (
        <dl className="ml-auto w-56 space-y-0.5 tabular">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatInr(totals.subtotalInr, { paise: true })}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Tax ({tax}%)</dt><dd>{formatInr(totals.taxInr, { paise: true })}</dd></div>
          <div className="flex justify-between font-semibold text-primary"><dt>Total</dt><dd>{formatInr(totals.totalInr, { paise: true })}</dd></div>
        </dl>
      ) : <p className="text-right text-2xs text-muted">Totals appear once every line is complete.</p>}
    </div>
  );
}
