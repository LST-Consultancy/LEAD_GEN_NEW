import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getProposalNorms } from "@/lib/services/proposal-setup";
import { ProposalSetupView } from "@/components/admin/proposal-setup-view";

export const metadata: Metadata = { title: "Proposal Setup" };

export default async function ProposalSetupPage() {
  const ctx = await requireAuth();
  return <ProposalSetupView norms={await getProposalNorms(ctx)} />;
}
