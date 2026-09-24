import { OpportunitySearchView } from "@/components/opportunities/search-view";
import { listOpportunityProviders } from "@/lib/services/opportunity-providers";
import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { availableSources, pendingSources } from "@/lib/ingest/sources";
import { getCapabilities } from "@/lib/services/capabilities";
import { FindView } from "@/components/find/find-view";

export const metadata: Metadata = { title: "Find Opportunities" };

export default async function FindLeadsPage() {
  const ctx = await requireAuth();
  const [icpCount, capabilities] = await Promise.all([
    db.icpProfile.count({ where: { workspaceId: ctx.workspaceId, deletedAt: null } }),
    getCapabilities(ctx),
  ]);

  return (
    <div className="space-y-8 p-6"><OpportunitySearchView providers={await listOpportunityProviders(ctx)} /><details><summary className="cursor-pointer text-sm">Import your existing leads</summary><FindView
      hasIcp={icpCount > 0}
      sources={{ available: availableSources(), pending: pendingSources(), connected: [...capabilities.opportunity_discovery.providers, ...capabilities.contact_enrichment.providers] }}
    /></details></div>
  );
}
