import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getLeadDossier } from "@/lib/services/lead-detail";
import { recordAudit } from "@/lib/services/audit";
import { formatDate, formatInr } from "@/lib/format";
import { LEAD_STATUS, SIGNAL_TYPE_LABEL, type LeadStatusKey } from "@/lib/vocab";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Lead dossier", robots: { index: false } };

/**
 * A lead's dossier laid out for paper. Outside the app shell so it prints
 * cleanly, but it signs in and scopes exactly like the dossier screen: an
 * invisible lead is a 404. Contact details are included only for roles that
 * may export, since a printout leaves the product the same way a CSV does,
 * and locked contacts are never shown. Printing is audited.
 */
export default async function PrintDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const lead = await getLeadDossier(ctx, id);
  if (!lead) notFound();
  const canExport = ctx.permissions.includes(PERMISSIONS.LEADS_EXPORT);
  await recordAudit(ctx, { action: "lead.dossier_printed", objectType: "Lead", objectId: id, after: { contactsIncluded: canExport } });
  const contacts = canExport ? lead.contacts.filter((c) => !c.isLocked && c.value && !c.optedOutAt) : [];

  return (
    <main className="mx-auto max-w-3xl space-y-5 bg-surface px-6 py-8 text-sm text-primary print:max-w-none print:px-0 print:py-0">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link href={`/leads/${id}`} className="text-xs text-secondary hover:underline">← Back to the lead</Link>
        <PrintButton />
      </div>
      <header className="space-y-1 border-b border-border pb-3">
        <h1 className="text-xl font-semibold">{lead.person.name}</h1>
        <p className="text-secondary">{lead.person.title} at {lead.company.name}{lead.company.location ? ` · ${lead.company.location}` : ""}</p>
        <p className="text-xs text-muted">
          Tier {lead.tier} · {LEAD_STATUS[lead.status as LeadStatusKey]?.label ?? lead.status} · intent {String(lead.intent).toLowerCase()}
          {lead.scoring ? ` · score ${lead.scoring.displayScore.toFixed(1)} of 10` : " · not scored"}
          {lead.owner ? ` · owner ${lead.owner.name}` : ""} · printed {formatDate(new Date())}
        </p>
      </header>

      <section className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Why they surfaced</h2>
        <p>{lead.surfacedReason}</p>
      </section>

      <section className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Company</h2>
        <p>{[lead.company.industry, lead.company.employeeCount ? `${lead.company.employeeCount} people` : null, lead.company.website].filter(Boolean).join(" · ") || "Nothing more on record."}</p>
      </section>

      <section className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Contact</h2>
        {!canExport ? <p className="text-secondary">Contact details are left off: your role can&apos;t export contact data.</p>
          : contacts.length === 0 ? <p className="text-secondary">No revealed contact details.</p>
          : <ul>{contacts.map((c) => <li key={c.id}>{c.kind.replaceAll("_", " ").toLowerCase()}: {c.value} <span className="text-muted">({c.status.toLowerCase()})</span></li>)}</ul>}
      </section>

      <section className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Signals</h2>
        {lead.signals.length === 0 ? <p className="text-secondary">No signals on record.</p> : (
          <ul className="space-y-1.5">
            {lead.signals.slice(0, 10).map((s) => (
              <li key={s.id}><span className="font-medium">{s.title}</span> <span className="text-muted">— {SIGNAL_TYPE_LABEL[s.type] ?? s.type}, {s.sourceName}, {formatDate(s.occurredAt)}</span><br /><span className="text-secondary">{s.excerpt}</span></li>
            ))}
          </ul>
        )}
      </section>

      {lead.deals.length ? (
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Deals</h2>
          <ul>{lead.deals.map((d) => <li key={d.id}>{d.title} — {d.stage.name}, {formatInr(Number(d.valueInr))}</li>)}</ul>
        </section>
      ) : null}

      {lead.notes.length ? (
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Team notes</h2>
          <ul className="space-y-1">{lead.notes.slice(0, 10).map((n) => <li key={n.id} className="whitespace-pre-wrap">{n.body} <span className="text-muted">— {formatDate(n.createdAt)}</span></li>)}</ul>
        </section>
      ) : null}

      <footer className="border-t border-border pt-2 text-2xs text-muted">From Signalroom. Every line comes from a record in the workspace; scores are computed, not written by a model.</footer>
    </main>
  );
}
