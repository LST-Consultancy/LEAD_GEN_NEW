import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getMarketIntelligence, getSignalFreshness } from "@/lib/services/signals";
import { MarketView } from "@/components/intelligence/market-view";

export const metadata: Metadata = { title: "Market Intelligence" };

export default async function MarketPage() {
  const ctx = await requireAuth();
  const [market, freshness] = await Promise.all([
    getMarketIntelligence(ctx),
    getSignalFreshness(ctx),
  ]);
  return <MarketView market={market} freshness={freshness} />;
}
