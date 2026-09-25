import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { handleApiError, unauthorized, apiError } from "@/lib/api/respond";
import { getLeadDossier } from "@/lib/services/lead-detail";
import { recordAudit } from "@/lib/services/audit";
import { formatDate, formatInr } from "@/lib/format";
import { LEAD_STATUS, SIGNAL_TYPE_LABEL, type LeadStatusKey } from "@/lib/vocab";
import { renderPdf, type Block } from "@/lib/pdf/simple";

/**
 * The lead dossier as a downloaded PDF — the same content, scoping and export rule as the print
 * page: an invisible lead is a 404, contact details only for roles that may export, locked or
 * opted-out contacts never. Every download is audited, as a printout is.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError("not_found", "That lead was not found.", 404);
    const lead = await getLeadDossier(ctx, id);
    if (!lead) return apiError("not_found", "That lead was not found.", 404);
    const canExport = ctx.permissions.includes(PERMISSIONS.LEADS_EXPORT);
    const contacts = canExport ? lead.contacts.filter((c) => !c.isLocked && c.value && !c.optedOutAt) : [];
    const blocks: Block[] = [
      { kind: "title", text: lead.person.name },
      { kind: "text", text: `${lead.person.title} at ${lead.company.name}${lead.company.location ? ` · ${lead.company.location}` : ""}` },
      { kind: "muted", text: `Tier ${lead.tier} · ${LEAD_STATUS[lead.status as LeadStatusKey]?.label ?? lead.status} · intent ${String(lead.intent).toLowerCase()}${lead.scoring ? ` · score ${lead.scoring.displayScore.toFixed(1)} of 10` : " · not scored"}${lead.owner ? ` · owner ${lead.owner.name}` : ""} · exported ${formatDate(new Date())}` },
      { kind: "heading", text: "WHY THEY SURFACED" }, { kind: "text", text: lead.surfacedReason },
      { kind: "heading", text: "COMPANY" }, { kind: "text", text: [lead.company.industry, lead.company.employeeCount ? `${lead.company.employeeCount} people` : null, lead.company.website].filter(Boolean).join(" · ") || "Nothing more on record." },
      { kind: "heading", text: "CONTACT" },
      ...(!canExport ? [{ kind: "muted" as const, text: "Contact details are left off: your role can't export contact data." }]
        : contacts.length === 0 ? [{ kind: "muted" as const, text: "No revealed contact details." }]
        : contacts.map((c) => ({ kind: "text" as const, text: `${c.kind.replaceAll("_", " ").toLowerCase()}: ${c.value} (${c.status.toLowerCase()})` }))),
      { kind: "heading", text: "SIGNALS" },
      ...(lead.signals.length === 0 ? [{ kind: "muted" as const, text: "No signals on record." }] : lead.signals.slice(0, 10).flatMap((s) => [
        { kind: "text" as const, text: `${s.title} — ${SIGNAL_TYPE_LABEL[s.type] ?? s.type}, ${s.sourceName}, ${formatDate(s.occurredAt)}` },
        ...(s.excerpt ? [{ kind: "muted" as const, text: s.excerpt }] : []),
      ])),
      ...(lead.deals.length ? [{ kind: "heading" as const, text: "DEALS" }, ...lead.deals.map((d) => ({ kind: "text" as const, text: `${d.title} — ${d.stage.name}, ${formatInr(Number(d.valueInr))}` }))] : []),
      ...(lead.notes.length ? [{ kind: "heading" as const, text: "TEAM NOTES" }, ...lead.notes.slice(0, 10).map((n) => ({ kind: "text" as const, text: `${n.body} — ${formatDate(n.createdAt)}` }))] : []),
      { kind: "muted", text: "From Signalroom. Every line comes from a record in the workspace; scores are computed, not written by a model." },
    ];
    await recordAudit(ctx, { action: "lead.dossier_pdf", objectType: "Lead", objectId: id, after: { contactsIncluded: canExport } });
    const pdf = renderPdf(blocks, { title: `${lead.person.name} — dossier`, footer: `${lead.person.name} · ${lead.company.name}` });
    const file = `${lead.person.name}-${lead.company.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "dossier";
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${file}.pdf"`, "Cache-Control": "no-store" } });
  } catch (err) { return handleApiError(err); }
}
