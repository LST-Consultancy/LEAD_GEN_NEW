import { describe, expect, it } from "vitest";
import { allowedAmounts, findMoney, findUncomputedAmount } from "@/lib/proposals/money-guard";

/**
 * The highest-stakes check in the product.
 *
 * A wrong figure in an email is embarrassing. A wrong figure in a proposal is
 * something a customer accepts and then holds you to, so the rule is that every
 * monetary figure in generated prose must match a computed line amount exactly.
 */

describe("findMoney", () => {
  it("reads a plain rupee amount", () => {
    expect(findMoney("The total is ₹1800000 including GST.")[0].rupees).toBe(1_800_000);
  });

  it("reads Indian digit grouping", () => {
    // 18,00,000 is not 1,800,000 to a naive comma-stripper written for the
    // thousands convention — it happens to be here, which is why it is tested.
    expect(findMoney("₹18,00,000")[0].rupees).toBe(1_800_000);
  });

  it("reads lakh and crore, which are how these prices are actually written", () => {
    expect(findMoney("₹18 lakh")[0].rupees).toBe(1_800_000);
    expect(findMoney("₹1.6 crore")[0].rupees).toBe(16_000_000);
    expect(findMoney("Rs 45L")[0].rupees).toBe(4_500_000);
  });

  it("reads a magnitude word without a currency symbol", () => {
    expect(findMoney("roughly 24 lakh for the rollout")[0].rupees).toBe(2_400_000);
  });

  it("accepts Rs, Rs. and INR", () => {
    for (const prefix of ["Rs 500000", "Rs. 500000", "INR 500000"]) {
      expect(findMoney(prefix)[0].rupees, prefix).toBe(500_000);
    }
  });

  it("finds every figure, not just the first", () => {
    expect(findMoney("₹18 lakh now and ₹6 lakh later")).toHaveLength(2);
  });

  it("ignores prose with no money in it", () => {
    expect(findMoney("A phased rollout across four sites over 16 weeks.")).toEqual([]);
  });

  it("does not mistake a bare number for a price", () => {
    // "16 weeks" and "four sites" are not amounts.
    expect(findMoney("16 weeks, 4 sites, 12 users")).toEqual([]);
  });
});

describe("findUncomputedAmount", () => {
  const computed = [1_800_000, 324_000, 2_124_000, 450_000];

  it("passes prose that only quotes computed amounts", () => {
    expect(
      findUncomputedAmount("The engagement is ₹18 lakh plus ₹3,24,000 GST.", computed)
    ).toBeNull();
  });

  it("catches a price the model made up", () => {
    // The single failure this whole module exists to prevent.
    const found = findUncomputedAmount("We can deliver this for ₹24 lakh.", computed);
    expect(found?.rupees).toBe(2_400_000);
  });

  it("catches a plausible-looking total that is not the real one", () => {
    // 1,800,000 + 324,000 = 2,124,000. This says 2,120,000.
    expect(findUncomputedAmount("Total ₹21,20,000.", computed)?.rupees).toBe(2_120_000);
  });

  it("matches the same amount written a different way", () => {
    // ₹18 lakh and 18,00,000 must both pass against the same computed figure.
    expect(findUncomputedAmount("₹18,00,000 for the phase.", computed)).toBeNull();
    expect(findUncomputedAmount("₹18 lakh for the phase.", computed)).toBeNull();
  });

  it("tolerates a one-rupee rounding difference and no more", () => {
    expect(findUncomputedAmount("₹18,00,001", computed)).toBeNull();
    expect(findUncomputedAmount("₹18,00,100", computed)?.rupees).toBe(1_800_100);
  });

  it("returns the first offender so the message can name it", () => {
    const found = findUncomputedAmount("₹24 lakh, or ₹30 lakh with support.", computed);
    expect(found?.rupees).toBe(2_400_000);
  });

  it("refuses every figure when nothing was computed", () => {
    expect(findUncomputedAmount("It costs ₹5 lakh.", [])?.rupees).toBe(500_000);
  });
});

describe("allowedAmounts", () => {
  it("permits unit prices as well as line totals", () => {
    // "at ₹2.5 lakh per site" is a line item's own price, not an invention.
    const allowed = allowedAmounts({
      items: [{ unitPriceInr: 250_000, amountInr: 1_000_000 }],
      subtotalInr: 1_000_000,
      taxInr: 180_000,
      totalInr: 1_180_000,
    });
    expect(findUncomputedAmount("₹2.5 lakh per site, ₹10 lakh in total.", allowed)).toBeNull();
  });

  it("permits the tax line and the grand total", () => {
    const allowed = allowedAmounts({
      items: [{ unitPriceInr: 100, amountInr: 1_000_000 }],
      subtotalInr: 1_000_000,
      taxInr: 180_000,
      totalInr: 1_180_000,
    });
    expect(findUncomputedAmount("₹1,80,000 GST, ₹11,80,000 payable.", allowed)).toBeNull();
  });
});
