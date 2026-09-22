/**
 * Proposal arithmetic.
 *
 * Pure, and done in **integer paise** throughout. A proposal total is a number
 * a customer may be invoiced against, so `0.1 + 0.2` problems are not
 * acceptable: `1234.56 * 3` in float is 3703.6800000000003, and a subtotal
 * built by adding floats drifts by paise that then disagree with the line
 * items shown above it.
 *
 * Every function here takes and returns rupees as `number` at the boundary,
 * because that is what the database column holds, but converts to paise before
 * doing any arithmetic.
 */

export type LineItemInput = {
  name: string;
  quantity: number;
  unitPriceInr: number;
};

export type LineItem = LineItemInput & {
  /** quantity × unit price, rounded once, at this line. */
  amountInr: number;
};

export type Totals = {
  subtotalInr: number;
  taxRate: number;
  taxInr: number;
  totalInr: number;
};

/** Rupees → integer paise. Rounds half away from zero, like an invoice would. */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) return 0;
  // Multiply as a string-free operation but correct the float error that
  // `rupees * 100` introduces for values like 1234.565.
  const scaled = rupees * 100;
  const rounded = Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled));
  return rupees < 0 ? -rounded : rounded;
}

/** Integer paise → rupees, with exactly two decimal places of value. */
export function toRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/**
 * One line's amount. Rounded **here**, so the figure printed beside the line
 * is the figure that goes into the subtotal. Rounding only at the end produces
 * a subtotal that does not equal the sum of the visible lines.
 */
export function lineAmount(item: LineItemInput): number {
  const paise = Math.round(toPaise(item.unitPriceInr) * item.quantity);
  return toRupees(paise);
}

export function priceItems(items: LineItemInput[]): LineItem[] {
  return items.map((item) => ({ ...item, amountInr: lineAmount(item) }));
}

/**
 * Subtotal, tax and total from the *rounded* line amounts.
 *
 * `taxRate` is a percentage (18 for 18% GST). Tax is computed on the subtotal
 * rather than per line, which is what an Indian tax invoice does for a single
 * GST rate, and is stated as such on the proposal.
 */
export function computeTotals(items: LineItemInput[], taxRate: number): Totals {
  const priced = priceItems(items);
  const subtotalPaise = priced.reduce((sum, i) => sum + toPaise(i.amountInr), 0);
  const taxPaise = Math.round((subtotalPaise * taxRate) / 100);

  return {
    subtotalInr: toRupees(subtotalPaise),
    taxRate,
    taxInr: toRupees(taxPaise),
    totalInr: toRupees(subtotalPaise + taxPaise),
  };
}

/**
 * Checks stored totals against a recomputation of the same items.
 *
 * Used before a proposal is sent and when one is opened, because a total that
 * disagrees with its own line items is the single worst thing this feature
 * could show a customer. Returns the discrepancy rather than silently
 * "fixing" it, so the mismatch is visible and traceable.
 */
export function reconcile(
  items: LineItemInput[],
  stored: Totals
): { ok: true } | { ok: false; expected: Totals; differences: string[] } {
  const expected = computeTotals(items, stored.taxRate);
  const differences: string[] = [];

  const compare = (label: string, a: number, b: number) => {
    // Paise-exact: anything at all is a difference worth reporting.
    if (toPaise(a) !== toPaise(b)) {
      differences.push(`${label} is stored as ₹${b.toFixed(2)} but the items come to ₹${a.toFixed(2)}`);
    }
  };

  compare("Subtotal", expected.subtotalInr, stored.subtotalInr);
  compare("Tax", expected.taxInr, stored.taxInr);
  compare("Total", expected.totalInr, stored.totalInr);

  return differences.length === 0 ? { ok: true } : { ok: false, expected, differences };
}

/**
 * Whether a proposal is past its validity date.
 *
 * Deliberately date-based rather than instant-based: a proposal valid until
 * the 30th is valid for the whole of the 30th in the workspace's timezone, not
 * until midnight UTC — which in IST would expire it at 05:30 on the 30th.
 */
export function isExpired(
  validUntil: Date | string | null,
  now: Date = new Date(),
  timezone = "Asia/Kolkata"
): boolean {
  if (!validUntil) return false;
  const until = typeof validUntil === "string" ? new Date(validUntil) : validUntil;
  return localDateKey(now, timezone) > localDateKey(until, timezone);
}

/** YYYY-MM-DD in a given timezone, for comparing calendar days. */
export function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Days left, floored, or null when there is no validity date. */
export function daysUntilExpiry(
  validUntil: Date | string | null,
  now: Date = new Date(),
  timezone = "Asia/Kolkata"
): number | null {
  if (!validUntil) return null;
  const until = typeof validUntil === "string" ? new Date(validUntil) : validUntil;
  const a = localDateKey(now, timezone);
  const b = localDateKey(until, timezone);
  // Compare calendar days so "expires today" is 0, not a fraction.
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
