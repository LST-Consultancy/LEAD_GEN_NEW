import "server-only";

import {
  MODEL_ROUTING,
  FEATURE_TIER,
  modelForProvider,
  type ProviderName,
  type ModelTier,
} from "@/lib/ai/routing";

/**
 * §87 — provider abstraction. Nothing in the product imports a vendor SDK
 * directly, so swapping or adding a model provider is a change here only.
 *
 * With no key configured, `isConfigured()` is false and every AI feature must
 * degrade to an explicit "not configured" state. Inventing output would be
 * worse than admitting the gap (§126).
 *
 * The routing table lives in `routing.ts` because it is pure data; only the
 * key-reading lives here, which is what makes this module server-only.
 */

export { MODEL_ROUTING, FEATURE_TIER };
export type { ProviderName, ModelTier };

export function activeProvider(): ProviderName {
  const name = process.env.AI_DEFAULT_PROVIDER as ProviderName | undefined;
  return name && name in MODEL_ROUTING ? name : "anthropic";
}

function keyFor(provider: ProviderName): string | undefined {
  const key = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  }[provider];
  return key && key.length > 0 ? key : undefined;
}

export function isConfigured(provider: ProviderName = activeProvider()): boolean {
  return keyFor(provider) !== undefined;
}

export function modelFor(feature: string, provider: ProviderName = activeProvider()): string {
  return modelForProvider(feature, provider);
}

export const NOT_CONFIGURED_MESSAGE =
  "No AI provider is configured for this workspace, so I can't generate free-form answers yet. " +
  "I can still answer anything that comes from a real query against your data — the suggestions " +
  "below all work. Add a provider key in Settings → AI Assistant to enable generated text.";
