import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { leadLensReadiness } from "@/lib/services/lead-lens";
import { LeadLensView } from "@/components/intelligence/lead-lens-view";

export const metadata: Metadata = { title: "Lead Lens" };

export default async function LeadLensPage() {
  const ctx = await requireAuth();
  return <LeadLensView readiness={await leadLensReadiness(ctx)} />;
}
