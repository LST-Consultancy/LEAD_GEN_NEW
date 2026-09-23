import { requireAuth } from "@/lib/auth/context";
import { listDiscoveryCandidates } from "@/lib/services/discovery-review";
import { DiscoveryReview } from "@/components/opportunities/discovery-review";
export const metadata = { title: "Discovery review" };
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ searchId?: string }> }) {
  const ctx = await requireAuth(); const { searchId } = await searchParams;
  return <DiscoveryReview items={await listDiscoveryCandidates(ctx, searchId)} canEdit={ctx.permissions.includes("leads.edit")} />;
}
