import Link from "next/link";
import { getDemandByType, listOpportunities } from "@/lib/services/opportunities";
import { DemandByTypeCard } from "@/components/intelligence/reporting-cards";
import { OpportunityTable } from "@/components/opportunities/table";
import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getLiveDemand, getSignalFreshness } from "@/lib/services/signals";
import { LiveDemandView } from "@/components/intelligence/live-demand-view";

export const metadata: Metadata = { title: "Live Demand" };

export default async function LiveDemandPage() {
  const ctx = await requireAuth();
  const [demand, freshness, byType] = await Promise.all([
    getLiveDemand(ctx),
    getSignalFreshness(ctx),
    getDemandByType(ctx),
  ]);
  return <div className="space-y-6"><section className="space-y-4 p-4"><h1 className="text-xl font-semibold">Live opportunity demand</h1><Link href="/find-leads" className="text-sm underline">Discover new requirements</Link><DemandByTypeCard total={byType.total} capped={byType.capped} types={byType.types} /><OpportunityTable data={await listOpportunities(ctx, { status: "ACTIVE" })} /></section><LiveDemandView demand={demand} freshness={freshness} /></div>;
}
