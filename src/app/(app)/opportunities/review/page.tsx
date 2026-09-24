import { requireAuth } from "@/lib/auth/context";
import { discoveryReasonCounts, listDiscoveryCandidates } from "@/lib/services/discovery-review";
import { DiscoveryReview } from "@/components/opportunities/discovery-review";
export const metadata = { title: "Discovery review" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ searchId?: string; status?: string; reason?: string }> }) {
  const ctx = await requireAuth(); const params = await searchParams;
  // Parse tolerantly: a stale or hand-edited link drops the bad field and keeps the rest.
  const searchId = params.searchId && uuid.test(params.searchId) ? params.searchId : undefined;
  const status = params.status === "REJECTED" ? "REJECTED" : "REVIEW";
  const reason = params.reason && /^[a-z_]{1,40}$/.test(params.reason) ? params.reason : undefined;
  const [items, counts] = await Promise.all([listDiscoveryCandidates(ctx, { searchId, status, reason }), discoveryReasonCounts(ctx, searchId)]);
  return <DiscoveryReview items={items} counts={counts} filter={{ searchId, status, reason }} canEdit={ctx.permissions.includes("leads.edit")} />;
}
