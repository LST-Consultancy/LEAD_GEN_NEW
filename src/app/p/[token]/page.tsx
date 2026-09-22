import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicProposal } from "@/lib/services/proposal-public";
import { ProposalClient } from "./proposal-client";

/**
 * The public proposal, deliberately outside the `(app)` route group so no
 * authentication runs. The token is the authorisation.
 */
/**
 * The tab title is the *sender's* name, not ours.
 *
 * The root layout templates every title as "… · Signalroom", which is right
 * everywhere the reader is our user and wrong here: a prospect reading a
 * proposal should see who sent it, not which tool produced it. `absolute`
 * opts out of the template.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const proposal = await getPublicProposal(token);
  return {
    title: proposal
      ? { absolute: `${proposal.title} · ${proposal.workspace.name}` }
      : { absolute: "Proposal" },
    description: proposal
      ? `Proposal from ${proposal.workspace.name} for ${proposal.company.name}.`
      : undefined,
    // A proposal link is private by obscurity; keep it out of indexes.
    robots: { index: false, follow: false },
  };
}

export default async function PublicProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const proposal = await getPublicProposal(token);
  // A wrong, expired-away or unpublished token is indistinguishable from one
  // that never existed. Nothing here confirms whether a proposal is behind it.
  if (!proposal) notFound();

  return <ProposalClient proposal={proposal} token={token} />;
}
