"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, FileText, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatInr } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PublicProposal } from "@/lib/services/proposal-public";

/**
 * The prospect's view.
 *
 * Deliberately outside the app shell: no navigation, no branding of ours
 * beyond a discreet footer, nothing that implies the reader has an account.
 * The only interactive things are accept, decline and print.
 */
export function ProposalClient({
  proposal,
  token,
}: {
  proposal: PublicProposal;
  token: string;
}) {
  const [state, setState] = useState(proposal);
  const [decision, setDecision] = useState<"accept" | "decline" | null>(null);
  const [byName, setByName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // One view per page load, recorded through the API so the server decides
  // whether it counts.
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    void fetch(`/api/public/proposals/${token}/view`, { method: "POST" }).catch(() => {
      // A failed view record must never break the page the customer came to read.
    });
  }, [token]);

  const submit = async () => {
    if (!decision) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/proposals/${token}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, byName, reason: reason || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "That did not go through. Please try again.");
        return;
      }
      setDone(body.note);
      setState({
        ...state,
        state: decision === "accept" ? "ACCEPTED" : "DECLINED",
        canDecide: false,
        acceptedAt: decision === "accept" ? new Date().toISOString() : null,
        declinedAt: decision === "decline" ? new Date().toISOString() : null,
      });
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const sections = Array.isArray(state.sections)
    ? (state.sections as { key: string; title: string; body: string }[])
    : [];

  // The sections are author-written and often already include a "Terms"
  // block, while `terms` is a separate stored field. Rendering both under the
  // same heading gave the customer two different sets of terms with no way to
  // tell which governed. When the authored sections already cover it, the
  // stored field is headed distinctly instead.
  const termsHeading = sections.some((s) => s.title.trim().toLowerCase().startsWith("terms"))
    ? "Terms and conditions"
    : "Terms";

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          {state.workspace.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a stored data URL or remote logo; next/image cannot optimise either
            <img src={state.workspace.logoUrl} alt={`${state.workspace.name} logo`} className="mb-3 h-10 max-w-40 object-contain" />
          ) : null}
          <p className="text-2xs uppercase tracking-wider text-muted">
            Proposal from {state.workspace.name}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-primary sm:text-2xl">{state.title}</h1>
          <p className="mt-1 text-xs text-secondary">Prepared for {state.company.name}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="print:hidden"
          onClick={() => window.print()}
        >
          <Printer />
          Print
        </Button>
      </header>

      <StatusBanner proposal={state} />

      {sections.length > 0 ? (
        <div className="mb-8 flex flex-col gap-5">
          {sections.map((s) => (
            <section key={s.key}>
              <h2 className="text-sm font-semibold text-primary">{s.title}</h2>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-secondary">
                {s.body}
              </p>
            </section>
          ))}
        </div>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-primary">What is included</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <caption className="sr-only">Proposal line items and totals</caption>
            <thead className="bg-surface-sunken">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 text-left font-semibold text-secondary">
                  Item
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold text-secondary">
                  Qty
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold text-secondary">
                  Unit price
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold text-secondary">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((item, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium text-primary">{item.name}</span>
                    {item.description ? (
                      <span className="mt-0.5 block text-2xs text-muted">{item.description}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular text-secondary">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular text-secondary">
                    {formatInr(item.unitPriceInr)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular font-medium text-primary">
                    {formatInr(item.amountInr)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-sunken">
              <tr>
                <td colSpan={3} className="px-3 py-1.5 text-right text-2xs text-secondary">
                  Subtotal
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-secondary">
                  {formatInr(state.subtotalInr)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="px-3 py-1.5 text-right text-2xs text-secondary">
                  GST at {state.taxRate}%
                  <span className="ml-1 text-muted">(on the subtotal)</span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-secondary">
                  {formatInr(state.taxInr)}
                </td>
              </tr>
              <tr className="border-t border-border">
                <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-primary">
                  Total
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular text-sm font-semibold text-primary">
                  {formatInr(state.totalInr)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {state.terms ? (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-primary">{termsHeading}</h2>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-secondary">
            {state.terms}
          </p>
        </section>
      ) : null}

      <section className="print:hidden">
        {done ? (
          <div className="rounded-lg border border-success-border bg-success-subtle px-4 py-3 text-xs text-success-text">
            <Check className="mr-1 inline size-3.5" />
            {done}
          </div>
        ) : state.canDecide ? (
          <div className="rounded-lg border border-border bg-surface-sunken p-4">
            {decision === null ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-secondary">
                  If this looks right, accepting tells {state.workspace.name} to proceed. If it
                  does not, saying so saves you both a follow-up.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={() => setDecision("accept")}>
                    <Check />
                    Accept this proposal
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setDecision("decline")}>
                    <X />
                    Decline
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-primary">
                  {decision === "accept"
                    ? `Accepting ${formatInr(state.totalInr)} — including GST`
                    : "Declining this proposal"}
                </p>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="by-name">Your name</Label>
                  <Input
                    id="by-name"
                    value={byName}
                    onChange={(e) => setByName(e.target.value)}
                    placeholder="The name you are answering under"
                    autoComplete="name"
                  />
                  <p className="text-2xs text-muted">
                    Recorded with your answer. This page does not verify who you are, so the
                    name is kept as what you typed.
                  </p>
                </div>
                {decision === "decline" ? (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="reason">Why</Label>
                    <Input
                      id="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Price, timing, went another way…"
                    />
                  </div>
                ) : null}
                {error ? (
                  <p className="rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-2xs text-danger-text">
                    {error}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={decision === "accept" ? "primary" : "danger"}
                    size="sm"
                    disabled={
                      busy ||
                      byName.trim().length < 2 ||
                      (decision === "decline" && reason.trim().length < 2)
                    }
                    onClick={() => void submit()}
                  >
                    {decision === "accept" ? <Check /> : <X />}
                    {decision === "accept" ? "Confirm acceptance" : "Confirm decline"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setDecision(null);
                      setError(null);
                    }}
                  >
                    Back
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-xs text-secondary">
            {state.cannotDecideBecause}
          </div>
        )}
      </section>

      <footer className="mt-10 border-t border-border-subtle pt-4 text-2xs text-muted">
        <p>
          Sent to you by {state.workspace.name}. If anything here looks wrong, reply to the
          message that brought you this link rather than answering above.
        </p>
        {state.workspace.contact ? (
          <p className="mt-1">
            {[state.workspace.contact.email, state.workspace.contact.phone, state.workspace.contact.website, state.workspace.contact.address].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </footer>
    </main>
  );
}

function StatusBanner({ proposal }: { proposal: PublicProposal }) {
  if (proposal.acceptedAt) {
    return (
      <div className="mb-6 rounded-lg border border-success-border bg-success-subtle px-4 py-2.5 text-xs text-success-text">
        <Check className="mr-1 inline size-3.5" />
        Accepted on {new Date(proposal.acceptedAt).toLocaleDateString("en-IN", { dateStyle: "long" })}.
      </div>
    );
  }
  if (proposal.declinedAt) {
    return (
      <div className="mb-6 rounded-lg border border-border bg-surface-sunken px-4 py-2.5 text-xs text-secondary">
        <X className="mr-1 inline size-3.5" />
        Declined on {new Date(proposal.declinedAt).toLocaleDateString("en-IN", { dateStyle: "long" })}.
      </div>
    );
  }
  if (proposal.expired) {
    return (
      <div className="mb-6 rounded-lg border border-warning-border bg-warning-surface px-4 py-2.5 text-xs text-warning-text">
        <AlertTriangle className="mr-1 inline size-3.5" />
        This proposal was valid until{" "}
        {proposal.validUntil
          ? new Date(proposal.validUntil).toLocaleDateString("en-IN", { dateStyle: "long" })
          : "an earlier date"}
        , so it can no longer be accepted here.
      </div>
    );
  }
  if (proposal.daysUntilExpiry !== null && proposal.daysUntilExpiry <= 7) {
    return (
      <div
        className={cn(
          "mb-6 rounded-lg border px-4 py-2.5 text-xs",
          "border-border bg-surface-sunken text-secondary"
        )}
      >
        <Clock className="mr-1 inline size-3.5" />
        {proposal.daysUntilExpiry === 0
          ? "Valid until the end of today."
          : `Valid for ${proposal.daysUntilExpiry} more ${proposal.daysUntilExpiry === 1 ? "day" : "days"}.`}
      </div>
    );
  }
  return (
    <div className="mb-6 flex items-center gap-1.5 text-2xs text-muted">
      <FileText className="size-3" />
      {proposal.validUntil
        ? `Valid until ${new Date(proposal.validUntil).toLocaleDateString("en-IN", { dateStyle: "long" })}.`
        : "No expiry date on this proposal."}
    </div>
  );
}
