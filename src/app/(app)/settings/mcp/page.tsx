import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireAuth } from "@/lib/auth/context";
import { TOOLS } from "@/lib/ai/tools";
import { API_SCOPES } from "@/lib/auth/api-scopes";
import { McpView } from "@/components/integrations/mcp-view";

export const metadata: Metadata = { title: "MCP" };

export default async function McpPage() {
  await requireAuth();

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return (
    <McpView
      tools={TOOLS.map((t) => ({
        name: t.name,
        riskClass: t.riskClass,
        description: t.description,
        implemented: t.implemented,
      }))}
      scopes={API_SCOPES.map((s) => ({
        key: s.key,
        label: s.label,
        risk: s.risk,
        describes: s.describes,
      }))}
      // There is no MCP transport yet. Stated rather than implied.
      serverRunning={false}
      baseUrl={`${proto}://${host}`}
    />
  );
}
