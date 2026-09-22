import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { availableSources, pendingSources } from "@/lib/ingest/sources";
import { FindView } from "@/components/find/find-view";

export const metadata: Metadata = { title: "Find Leads" };

export default async function FindLeadsPage() {
  const ctx = await requireAuth();
  const icpCount = await db.icpProfile.count({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
  });

  return (
    <FindView
      hasIcp={icpCount > 0}
      sources={{ available: availableSources(), pending: pendingSources() }}
    />
  );
}
