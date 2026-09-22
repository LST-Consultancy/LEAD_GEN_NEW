import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { listAgentRuns } from "@/lib/services/autopilot";
import { ActivityView } from "@/components/autopilot/activity-view";

export const metadata: Metadata = { title: "Agent Activity" };

export default async function AgentActivityPage() {
  const ctx = await requireAuth();
  return <ActivityView runs={await listAgentRuns(ctx, 60)} />;
}
