import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getFunnel, getSourceAttribution } from "@/lib/services/analytics";
import { InsightsView } from "@/components/intelligence/insights-view";

export const metadata: Metadata = { title: "Insights" };

export default async function InsightsPage() {
  const ctx = await requireAuth();
  const [funnel, attribution] = await Promise.all([
    getFunnel(ctx),
    getSourceAttribution(ctx),
  ]);
  return <InsightsView funnel={funnel} attribution={attribution} />;
}
