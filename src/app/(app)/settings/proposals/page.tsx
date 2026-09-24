import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getProposalNorms } from "@/lib/services/proposal-setup";
import { ProposalSetupView } from "@/components/admin/proposal-setup-view";
import { getProposalDefaults } from "@/lib/services/proposal-defaults";
import { PERMISSIONS } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Proposal Setup" };

export default async function ProposalSetupPage() {
  const ctx = await requireAuth();
  const [norms, defaults] = await Promise.all([getProposalNorms(ctx), getProposalDefaults(ctx)]);
  return <ProposalSetupView norms={norms} defaults={defaults} canEdit={ctx.permissions.includes(PERMISSIONS.PIPELINE_CONFIGURE)} />;
}
