import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { TOOLS } from "@/lib/ai/tools";
import { CopilotConsole } from "@/components/ai/copilot-console";

export const metadata: Metadata = { title: "Copilot" };

export default async function CopilotPage() {
  await requireAuth();

  // The registry is the honest list of what the Copilot can do, so the screen
  // renders it rather than a hand-kept copy that would drift out of date.
  const tools = TOOLS.map((t) => ({
    name: t.name,
    riskClass: t.riskClass,
    description: t.description,
    implemented: t.implemented,
  }));

  return <CopilotConsole tools={tools} />;
}
