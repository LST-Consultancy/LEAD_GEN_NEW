import { sendingReady } from "@/lib/services/mailbox-sending";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireAuth } from "@/lib/auth/context";
import { listProposals } from "@/lib/services/proposals";
import { ProposalsView } from "@/components/proposals/proposals-view";

export const metadata: Metadata = { title: "Proposals" };

export default async function ProposalsPage() {
  const ctx = await requireAuth();
  const proposals = await listProposals(ctx);

  // The customer's link has to be absolute to be worth copying, and the host
  // is whatever this deployment is actually served on.
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return (
    <ProposalsView
      proposals={proposals}
      emailConfigured={await sendingReady(ctx.workspaceId)}
      baseUrl={`${proto}://${host}`}
    />
  );
}
