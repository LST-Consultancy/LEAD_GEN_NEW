import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getTeamPerformance } from "@/lib/services/analytics";
import { TeamView } from "@/components/intelligence/team-view";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireAuth();
  return <TeamView team={await getTeamPerformance(ctx)} />;
}
