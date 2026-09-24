import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getCompetitors, getSignalFreshness } from "@/lib/services/signals";
import { CompetitorsView } from "@/components/intelligence/competitors-view";
import { PERMISSIONS } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Competitors" };

export default async function CompetitorsPage() {
  const ctx = await requireAuth();
  const [result, freshness] = await Promise.all([
    getCompetitors(ctx),
    getSignalFreshness(ctx),
  ]);
  return (
    <CompetitorsView
      competitors={result.competitors}
      untracked={result.untracked}
      freshness={freshness}
      canManage={ctx.permissions.includes(PERMISSIONS.KNOWLEDGE_MANAGE)}
    />
  );
}
