import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getCohortFunnel, getFunnel, getLeadMix, getSourceAttribution } from "@/lib/services/analytics";
import { CohortFunnelCard, LeadMixCard } from "@/components/intelligence/reporting-cards";
import { InsightsView } from "@/components/intelligence/insights-view";

export const metadata: Metadata = { title: "Insights" };

export default async function InsightsPage() {
  const ctx = await requireAuth();
  const [funnel, attribution, cohort, mix] = await Promise.all([
    getFunnel(ctx),
    getSourceAttribution(ctx),
    getCohortFunnel(ctx),
    getLeadMix(ctx),
  ]);
  return (
    <div className="flex flex-col gap-3">
      <InsightsView funnel={funnel} attribution={attribution} />
      <div className="grid gap-3 lg:grid-cols-2">
        <CohortFunnelCard days={cohort.days} stages={cohort.stages} />
        <LeadMixCard rows={mix} />
      </div>
    </div>
  );
}
