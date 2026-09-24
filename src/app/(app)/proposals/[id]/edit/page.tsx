import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/context";
import { getProposal, proposalStartingPoint } from "@/lib/services/proposals";
import { ProposalEditor } from "@/components/proposals/proposal-editor";
import { getProposalDefaults } from "@/lib/services/proposal-defaults";
import { localDateKey } from "@/lib/proposals/money";

export const metadata: Metadata = { title: "Edit proposal" };

export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await getProposal(ctx, id);
  if (!p) notFound();
  const [start, defaults] = await Promise.all([proposalStartingPoint(ctx, { companyId: p.company.id }), getProposalDefaults(ctx)]);

  return (
    <ProposalEditor
      initial={{
        id: p.id,
        state: p.storedState,
        publicPath: p.publicPath,
        title: p.title,
        company: { id: p.company.id, name: p.company.name },
        leadId: p.lead?.id ?? "",
        dealId: p.deal?.id ?? "",
        taxRate: p.taxRate,
        validUntil: p.validUntil ? localDateKey(new Date(p.validUntil), ctx.workspace.timezone) : "",
        terms: p.terms ?? "",
        sections: Array.isArray(p.sections) ? (p.sections as { key: string; title: string; body: string }[]) : [],
        items: p.items.map((i: { name: string; description: string | null; quantity: number | string; unit: string; unitPriceInr: number | string }) => ({ name: i.name, description: i.description, quantity: Number(i.quantity), unit: i.unit, unitPriceInr: Number(i.unitPriceInr) })),
      }}
      leads={start?.leads ?? []}
      deals={start?.deals ?? []}
      normsHint={null}
      packages={defaults.packages}
      pricingNote={defaults.pricingNote}
    />
  );
}
