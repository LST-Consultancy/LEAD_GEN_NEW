import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { hasIngestionSource } from "@/lib/ingest/sources";
import { LeadLensView } from "@/components/intelligence/lead-lens-view";

export const metadata: Metadata = { title: "Lead Lens" };

export default async function LeadLensPage() {
  await requireAuth();
  return <LeadLensView enrichmentAvailable={hasIngestionSource()} />;
}
