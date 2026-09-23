import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { listSavedSearches } from "@/lib/services/lists";
import { listOpportunityProviders } from "@/lib/services/opportunity-providers";
import { AlertsView } from "@/components/intelligence/alerts-view";

export const metadata: Metadata = { title: "Saved & Alerts" };

export default async function SavedAlertsPage() {
  const ctx = await requireAuth();
  return (
    <AlertsView
      searches={await listSavedSearches(ctx)}
      discoveryConnected={(await listOpportunityProviders(ctx)).some(p => p.connection?.enabled && p.connection.allowedSearch && p.connection.allowedStorage)}
    />
  );
}
