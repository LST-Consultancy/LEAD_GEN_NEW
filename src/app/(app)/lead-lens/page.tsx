import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { leadLensReadiness } from "@/lib/services/lead-lens";
import { LeadLensView } from "@/components/intelligence/lead-lens-view";

export const metadata: Metadata = { title: "Lead Lens" };

export default async function LeadLensPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireAuth();
  const q = (await searchParams).q?.slice(0, 300) ?? "";
  return <LeadLensView readiness={await leadLensReadiness(ctx)} initialQuery={q} />;
}
