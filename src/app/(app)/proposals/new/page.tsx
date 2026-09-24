import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/context";
import { proposalStartingPoint } from "@/lib/services/proposals";
import { getProposalNorms } from "@/lib/services/proposal-setup";
import { getProposalDefaults } from "@/lib/services/proposal-defaults";
import { ProposalEditor } from "@/components/proposals/proposal-editor";
import { localDateKey } from "@/lib/proposals/money";

export const metadata: Metadata = { title: "New proposal" };

const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export default async function NewProposalPage({ searchParams }: { searchParams: Promise<{ leadId?: string; companyId?: string; dealId?: string }> }) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const leadId = uuid(sp.leadId); const dealId = uuid(sp.dealId);
  const [start, norms, defaults] = await Promise.all([
    proposalStartingPoint(ctx, { leadId, dealId, companyId: uuid(sp.companyId) }),
    getProposalNorms(ctx),
    getProposalDefaults(ctx),
  ]);
  if (!start) notFound();

  // Saved defaults win; without them, prefill from what proposals actually use, and say so.
  const commonRate = defaults.saved ? defaults.taxRate : norms.taxRates[0]?.rate;
  const validDays = defaults.saved ? defaults.validityDays : norms.medianValidityDays ?? 30;
  const validUntil = localDateKey(new Date(Date.now() + validDays * 86_400_000), ctx.workspace.timezone);

  return (
    <ProposalEditor
      initial={{
        title: start.company ? `Proposal for ${start.company.name}` : "",
        company: start.company,
        leadId: leadId ?? "",
        dealId: dealId ?? "",
        taxRate: commonRate ?? 18,
        validUntil,
        terms: defaults.terms ?? "",
        sections: [{ key: "scope", title: "Scope of work", body: "" }],
        items: [],
      }}
      leads={start.leads}
      deals={start.deals}
      normsHint={defaults.saved ? "From your proposal defaults." : commonRate !== undefined ? `Your most used rate, on ${norms.taxRates[0].count} of ${norms.total} proposals.` : "18% (GST) until you set defaults or have proposals of your own."}
      packages={defaults.packages}
      pricingNote={defaults.pricingNote}
    />
  );
}
