import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getAutopilotConfig, listAgents } from "@/lib/services/autopilot";
import { AgentsView } from "@/components/autopilot/agents-view";
import { PERMISSIONS } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "AI Agents" };

export default async function AgentsPage() {
  const ctx = await requireAuth();
  const [agents, config] = await Promise.all([listAgents(ctx), getAutopilotConfig(ctx)]);
  return <AgentsView agents={agents} aiConfigured={config.aiConfigured} canConfigure={ctx.permissions.includes(PERMISSIONS.AGENTS_CONFIGURE)} />;
}
