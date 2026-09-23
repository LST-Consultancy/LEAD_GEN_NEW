import { OpportunitySearchView } from "@/components/opportunities/search-view";
import { listOpportunityProviders } from "@/lib/services/opportunity-providers";
import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { availableSources, pendingSources } from "@/lib/ingest/sources";
import { FindView } from "@/components/find/find-view";

export const metadata: Metadata = { title: "Find Opportunities" };

export default async function FindLeadsPage() {
  const ctx = await requireAuth();
  const icpCount = await db.icpProfile.count({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
  });

  return (
    <div className="space-y-8 p-6"><OpportunitySearchView providers={await listOpportunityProviders(ctx)} /><details><summary className="cursor-pointer text-sm">Import your existing leads</summary><FindView
      hasIcp={icpCount > 0}
      sources={{ available: availableSources(), pending: pendingSources() }}
    /></details></div>
  );
}
