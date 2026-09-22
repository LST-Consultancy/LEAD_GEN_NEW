import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import {
  getAutopilotConfig,
  listAgents,
  listPendingActions,
} from "@/lib/services/autopilot";
import { AutopilotView } from "@/components/autopilot/autopilot-view";

export const metadata: Metadata = { title: "Autopilot" };

export default async function AutopilotPage() {
  const ctx = await requireAuth();
  const [config, agents, pending] = await Promise.all([
    getAutopilotConfig(ctx),
    listAgents(ctx),
    listPendingActions(ctx),
  ]);

  return <AutopilotView config={config} agents={agents} pending={pending} />;
}
