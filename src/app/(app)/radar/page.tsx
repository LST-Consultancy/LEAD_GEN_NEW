import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getRadar, getRunningWatches, getSignalFreshness } from "@/lib/services/signals";
import { RadarView } from "@/components/intelligence/radar-view";

export const metadata: Metadata = { title: "Radar" };

export default async function RadarPage() {
  const ctx = await requireAuth();
  const [watches, freshness, running] = await Promise.all([getRadar(ctx), getSignalFreshness(ctx), getRunningWatches(ctx)]);
  return <RadarView watches={watches} freshness={freshness} running={running} />;
}
