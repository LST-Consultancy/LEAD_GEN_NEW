import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getTrustSummary } from "@/lib/services/trust";
import { TrustView } from "@/components/autopilot/trust-view";

export const metadata: Metadata = { title: "Trust Center" };

export default async function TrustPage() {
  const ctx = await requireAuth();
  return <TrustView trust={await getTrustSummary(ctx)} />;
}
