/**
 * §60 — stopping a generated proposal from stating a price nobody computed.
 *
 * Pure, so the rule is testable on its own. This is the highest-stakes
 * enforcement in the product: a wrong figure in an outreach email is
 * embarrassing, a wrong figure in a proposal is something a customer accepts
 * and then holds you to.
 *
 * The rule is narrow on purpose. The model writes the narrative — scope,
 * approach, what happens in week one. Every *number* comes from the line items,
 * which are priced in integer paise by `money.ts`. So any monetary figure in
 * generated prose is, by definition, one the model produced itself, and is
 * refused unless it matches a computed one exactly.
 */

/** A money-like figure in prose: ₹18,00,000, ₹18 lakh, Rs 45L, 1.6 crore. */
const MONEY = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(lakh|lakhs|crore|crores|cr|l|k)?|\b([\d,]+(?:\.\d+)?)\s*(lakh|lakhs|crore|crores)\b/gi;

export type MoneyMention = { raw: string; rupees: number };

/**
 * Every monetary figure in the text, normalised to rupees.
 *
 * Indian magnitude words are the point: "₹18 lakh" and "₹18,00,000" are the
 * same number written two ways, and a check that compared strings would pass
 * one and fail the other.
 */
export function findMoney(text: string): MoneyMention[] {
  const found: MoneyMention[] = [];

  for (const match of text.matchAll(MONEY)) {
    const digits = match[1] ?? match[3];
    const magnitude = (match[2] ?? match[4] ?? "").toLowerCase();
    if (!digits) continue;

    const base = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;

    const multiplier =
      magnitude === "crore" || magnitude === "crores" || magnitude === "cr"
        ? 10_000_000
        : magnitude === "lakh" || magnitude === "lakhs" || magnitude === "l"
          ? 100_000
          : magnitude === "k"
            ? 1_000
            : 1;

    found.push({ raw: match[0].trim(), rupees: base * multiplier });
  }

  return found;
}

/**
 * The first figure in the text that does not match a computed amount.
 *
 * Tolerance is one rupee, to absorb the rounding between "₹18.5 lakh" and
 * 1,850,000 — not enough to let a materially different price through.
 */
export function findUncomputedAmount(
  text: string,
  computed: number[]
): MoneyMention | null {
  const allowed = computed.filter((n) => Number.isFinite(n));

  for (const mention of findMoney(text)) {
    const matches = allowed.some((value) => Math.abs(value - mention.rupees) <= 1);
    if (!matches) return mention;
  }
  return null;
}

/**
 * Figures a draft is allowed to quote: every line amount, every unit price,
 * and the three totals.
 *
 * Unit prices are included because a scope paragraph legitimately says "at
 * ₹2.5 lakh per site" — that is a line item's own price, not an invention.
 */
export function allowedAmounts(input: {
  items: { unitPriceInr: number; amountInr: number }[];
  subtotalInr: number;
  taxInr: number;
  totalInr: number;
}): number[] {
  return [
    ...input.items.map((i) => i.unitPriceInr),
    ...input.items.map((i) => i.amountInr),
    input.subtotalInr,
    input.taxInr,
    input.totalInr,
  ];
}
