import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getLiveDemand, getSignalFreshness } from "@/lib/services/signals";
import { LiveDemandView } from "@/components/intelligence/live-demand-view";

export const metadata: Metadata = { title: "Live Demand" };

export default async function LiveDemandPage() {
  const ctx = await requireAuth();
  const [demand, freshness] = await Promise.all([
    getLiveDemand(ctx),
    getSignalFreshness(ctx),
  ]);
  return <LiveDemandView demand={demand} freshness={freshness} />;
}
