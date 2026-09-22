import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getAiSettings, priceExample, tierModels } from "@/lib/services/ai-settings";
import { modelFor } from "@/lib/ai/provider";
import { AiSettingsView } from "@/components/ai/ai-settings-view";

export const metadata: Metadata = { title: "AI Assistant" };

export default async function AiSettingsPage() {
  const ctx = await requireAuth();
  const settings = await getAiSettings(ctx);

  // The worked example on the screen is priced by the same function that prices
  // a real call, so the two can never disagree.
  const exampleModel = modelFor("natural_language_analytics");

  return (
    <AiSettingsView
      settings={settings}
      tiers={tierModels()}
      exampleModel={exampleModel}
      exampleCostInr={priceExample(exampleModel, 3000, 250)}
    />
  );
}
