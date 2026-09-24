"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api/client";
import { formatDate, formatInr } from "@/lib/format";

type Money = {
  wonInr: number; invoicedInr: number; paidInr: number; outstandingInr: number; unbilledInr: number | null;
  entries: { id: string; kind: "invoice" | "payment" | "adjustment"; amountInr: number; reference: string | null; date: string | null; note: string | null }[];
};
const KIND_LABEL = { invoice: "Invoice", payment: "Payment", adjustment: "Adjustment" } as const;

/** Invoiced, paid and owed on a won deal. Won is never shown as paid. */
export function DealMoney({ dealId }: { dealId: string }) {
  const [money, setMoney] = React.useState<Money | null>(null);
  const [error, setError] = React.useState("");
  const [kind, setKind] = React.useState<"invoice" | "payment" | "adjustment" | null>(null);
  const [amount, setAmount] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [date, setDate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const load = React.useCallback(() => { api.get<Money>(`/api/deals/${dealId}/money`).then(setMoney, (e) => setError(e instanceof ApiError ? e.message : "Couldn't load.")); }, [dealId]);
  React.useEffect(load, [load]);

  async function save() {
    if (!kind) return;
    setPending(true); setError("");
    try {
      await api.post(`/api/deals/${dealId}/money`, { kind, amountInr: Number(amount), reference: reference.trim() || undefined, date: new Date(`${date}T12:00:00`).toISOString(), note: note.trim() || undefined });
      toast.success(`${KIND_LABEL[kind]} recorded`);
      setKind(null); setAmount(""); setReference(""); setDate(""); setNote(""); load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Not recorded. Nothing was changed."); } finally { setPending(false); }
  }

  if (!money) return error ? <p className="text-2xs text-danger-text">{error}</p> : <p className="text-2xs text-muted">Loading money…</p>;
  const valid = Number.isFinite(Number(amount)) && amount.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(date) && (kind !== "adjustment" || note.trim());
  return (
    <div className="mt-1.5 space-y-1.5 border-t border-border-subtle pt-1.5 text-2xs">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular sm:grid-cols-4">
        <div><dt className="text-muted">Invoiced</dt><dd className="text-primary">{formatInr(money.invoicedInr, { paise: true })}</dd></div>
        <div><dt className="text-muted">Collected</dt><dd className="text-primary">{formatInr(money.paidInr, { paise: true })}</dd></div>
        <div><dt className="text-muted">Outstanding</dt><dd className={money.outstandingInr > 0 ? "text-warning-text" : "text-primary"}>{formatInr(money.outstandingInr, { paise: true })}</dd></div>
        <div><dt className="text-muted">Not yet invoiced</dt><dd className="text-primary">{money.unbilledInr === null ? "—" : formatInr(money.unbilledInr, { paise: true })}</dd></div>
      </dl>
      {money.entries.length ? (
        <ul className="space-y-0.5 text-secondary">
          {money.entries.map((e) => <li key={e.id}>{KIND_LABEL[e.kind]} {formatInr(e.amountInr, { paise: true })}{e.reference ? ` · ${e.reference}` : ""}{e.date ? ` · ${e.kind === "payment" ? "received" : "due"} ${formatDate(e.date)}` : ""}{e.note ? ` — ${e.note}` : ""}</li>)}
        </ul>
      ) : <p className="text-muted">Nothing invoiced yet. Won is not paid — record the invoice when it goes out.</p>}
      {kind ? (
        <div className="space-y-1.5 rounded border border-border-subtle p-2">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <Input aria-label="Amount (₹)" inputMode="decimal" placeholder={kind === "adjustment" ? "± amount" : "Amount ₹"} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-7 text-2xs tabular" />
            <Input aria-label={kind === "payment" ? "Date received" : "Due date"} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-7 text-2xs" />
            {kind !== "adjustment" ? <Input aria-label="Reference" placeholder={kind === "invoice" ? "Invoice no." : "UTR / cheque no."} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className="h-7 text-2xs" /> : null}
          </div>
          <Input aria-label="Note" placeholder={kind === "adjustment" ? "Why it is being corrected (required)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="h-7 text-2xs" />
          {error ? <p className="text-danger-text">{error}</p> : null}
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => { setKind(null); setError(""); }} disabled={pending}>Cancel</Button>
            <Button size="xs" variant="primary" loading={pending} disabled={!valid} onClick={() => void save()}>Record {KIND_LABEL[kind].toLowerCase()}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant="secondary" onClick={() => setKind("invoice")}>Record invoice</Button>
          <Button size="xs" variant="secondary" disabled={money.outstandingInr <= 0} onClick={() => setKind("payment")}>Record payment</Button>
          <Button size="xs" variant="ghost" onClick={() => setKind("adjustment")}>Correct invoiced</Button>
        </div>
      )}
    </div>
  );
}
