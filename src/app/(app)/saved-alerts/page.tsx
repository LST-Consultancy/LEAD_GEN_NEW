import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { listSavedSearches } from "@/lib/services/lists";
import { hasIngestionSource } from "@/lib/ingest/sources";
import { AlertsView } from "@/components/intelligence/alerts-view";

export const metadata: Metadata = { title: "Saved & Alerts" };

export default async function SavedAlertsPage() {
  const ctx = await requireAuth();
  return (
    <AlertsView
      searches={await listSavedSearches(ctx)}
      discoveryConnected={hasIngestionSource()}
    />
  );
}
