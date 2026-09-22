/**
 * Indicative per-million-token prices in INR.
 *
 * Pure and DB-free, so the seed prices a row exactly as `complete()` prices a
 * real call. When these lived beside the provider call, the seed could not
 * import them and invented costs instead — which put figures on the AI usage
 * screen that traced to nothing.
 *
 * Marked indicative wherever a cost is shown, because list prices change and
 * nothing here calls a billing API. A number presented as exact that is merely
 * close is worse than one labelled approximate.
 */
const PRICE_INR_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 1250, output: 6250 },
  "claude-sonnet-5": { input: 250, output: 1250 },
  "claude-haiku-4-5-20251001": { input: 70, output: 350 },
  "gpt-4.1-mini": { input: 35, output: 140 },
  o4: { input: 900, output: 4500 },
  "gemini-2.5-flash": { input: 25, output: 100 },
  "gemini-2.5-pro": { input: 300, output: 1200 },
};

export function estimateCostInr(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_INR_PER_MTOK[model];
  // An unknown model is logged at zero rather than guessed at. `isPriced` lets
  // the screen say so instead of showing a confident ₹0.
  if (!price) return 0;
  const cost = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  // Four decimal places, matching the column.
  return Math.round(cost * 10_000) / 10_000;
}

export function isPriced(model: string): boolean {
  return model in PRICE_INR_PER_MTOK;
}
