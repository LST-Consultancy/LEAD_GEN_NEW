/**
 * §89 — which model each feature uses.
 *
 * Pure and DB-free, deliberately separate from `provider.ts`: that module reads
 * the environment for keys and so is `server-only`, which makes it unimportable
 * from the seed and from tests running outside Next. The routing table itself
 * is just data, and the seed needs it to label a logged call with the model
 * that call would really have used.
 */

export type ProviderName = "anthropic" | "openai" | "google";

export type ModelTier = "fast" | "reasoning" | "embedding";

/**
 * Cheap models for classification and extraction, strong reasoning models for
 * research and strategy. Routing lives in config, not at call sites.
 */
export const MODEL_ROUTING: Record<ProviderName, Record<ModelTier, string>> = {
  anthropic: {
    fast: "claude-haiku-4-5-20251001",
    reasoning: "claude-opus-5",
    embedding: "voyage-3",
  },
  openai: { fast: "gpt-4.1-mini", reasoning: "o4", embedding: "text-embedding-3-large" },
  google: { fast: "gemini-2.5-flash", reasoning: "gemini-2.5-pro", embedding: "text-embedding-004" },
};

/** Which tier each product feature uses. */
export const FEATURE_TIER: Record<string, ModelTier> = {
  daily_brief: "fast",
  lead_verdict: "fast",
  summarise_thread: "fast",
  classify_signal: "fast",
  extract_entities: "fast",
  buyer_attribution: "fast",
  coach_tip: "fast",
  draft_outreach: "reasoning",
  deep_research: "reasoning",
  account_plan: "reasoning",
  proposal_draft: "reasoning",
  natural_language_analytics: "reasoning",
  semantic_search: "embedding",
};

export function modelForProvider(feature: string, provider: ProviderName): string {
  const tier = FEATURE_TIER[feature] ?? "fast";
  return MODEL_ROUTING[provider][tier];
}
