import { describe, expect, it } from "vitest";
import {
  toPaise,
  toRupees,
  lineAmount,
  priceItems,
  computeTotals,
  reconcile,
  isExpired,
  daysUntilExpiry,
  localDateKey,
} from "@/lib/proposals/money";

describe("toPaise / toRupees", () => {
  it("round-trips whole rupees", () => {
    expect(toPaise(1500)).toBe(150_000);
    expect(toRupees(150_000)).toBe(1500);
  });

  it("handles the classic float cases exactly", () => {
    expect(toPaise(0.1) + toPaise(0.2)).toBe(30);
    expect(toRupees(toPaise(0.1) + toPaise(0.2))).toBe(0.3);
    // 1234.565 * 100 is 123456.49999999999 in float.
    expect(toPaise(1234.565)).toBe(123_457);
  });

  it("rounds half away from zero", () => {
    expect(toPaise(0.005)).toBe(1);
    expect(toPaise(-0.005)).toBe(-1);
  });

  it("survives a non-finite input rather than producing NaN money", () => {
    expect(toPaise(Number.NaN)).toBe(0);
    expect(toPaise(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("lineAmount", () => {
  it("multiplies without float drift", () => {
    // 1234.56 * 3 is 3703.6800000000003 in float.
    expect(lineAmount({ name: "x", quantity: 3, unitPriceInr: 1234.56 })).toBe(3703.68);
  });

  it("rounds a fractional quantity to paise", () => {
    expect(lineAmount({ name: "x", quantity: 2.5, unitPriceInr: 999.99 })).toBe(2499.98);
  });

  it("handles a zero-priced line", () => {
    expect(lineAmount({ name: "Included", quantity: 1, unitPriceInr: 0 })).toBe(0);
  });

  it("handles a discount line", () => {
    expect(lineAmount({ name: "Discount", quantity: 1, unitPriceInr: -50_000 })).toBe(-50_000);
  });
});

describe("computeTotals", () => {
  const items = [
    { name: "Implementation", quantity: 1, unitPriceInr: 1_800_000 },
    { name: "Licences", quantity: 25, unitPriceInr: 7_200 },
    { name: "Training", quantity: 3, unitPriceInr: 45_000 },
  ];

  it("sums, taxes and totals at 18% GST", () => {
    const t = computeTotals(items, 18);
    expect(t.subtotalInr).toBe(2_115_000);
    expect(t.taxInr).toBe(380_700);
    expect(t.totalInr).toBe(2_495_700);
  });

  it("makes the subtotal equal the sum of the printed line amounts", () => {
    // This is the property that breaks when rounding happens only at the end.
    const awkward = [
      { name: "a", quantity: 3, unitPriceInr: 333.335 },
      { name: "b", quantity: 7, unitPriceInr: 11.115 },
      { name: "c", quantity: 11, unitPriceInr: 0.005 },
    ];
    const t = computeTotals(awkward, 18);
    const printed = priceItems(awkward).reduce((s, i) => s + toPaise(i.amountInr), 0);
    expect(toPaise(t.subtotalInr)).toBe(printed);
  });

  it("totals to subtotal plus tax, exactly", () => {
    for (const rate of [0, 5, 12, 18, 28, 0.5]) {
      const t = computeTotals(items, rate);
      expect(toPaise(t.totalInr)).toBe(toPaise(t.subtotalInr) + toPaise(t.taxInr));
    }
  });

  it("charges no tax at a zero rate", () => {
    const t = computeTotals(items, 0);
    expect(t.taxInr).toBe(0);
    expect(t.totalInr).toBe(t.subtotalInr);
  });

  it("returns zeroes for an empty proposal rather than NaN", () => {
    expect(computeTotals([], 18)).toEqual({
      subtotalInr: 0,
      taxRate: 18,
      taxInr: 0,
      totalInr: 0,
    });
  });

  it("nets a discount line into the subtotal before tax", () => {
    const t = computeTotals(
      [
        { name: "Work", quantity: 1, unitPriceInr: 1_000_000 },
        { name: "Launch discount", quantity: 1, unitPriceInr: -100_000 },
      ],
      18
    );
    expect(t.subtotalInr).toBe(900_000);
    expect(t.taxInr).toBe(162_000);
  });
});

describe("reconcile", () => {
  const items = [{ name: "Work", quantity: 1, unitPriceInr: 1_000_000 }];

  it("passes when the stored totals match the items", () => {
    expect(reconcile(items, computeTotals(items, 18))).toEqual({ ok: true });
  });

  it("reports a mismatch instead of silently correcting it", () => {
    const stored = { subtotalInr: 1_000_000, taxRate: 18, taxInr: 180_000, totalInr: 999_999 };
    const result = reconcile(items, stored);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toContain("Total");
    expect(result.expected.totalInr).toBe(1_180_000);
  });

  it("catches a one-paise discrepancy", () => {
    const stored = { ...computeTotals(items, 18) };
    stored.taxInr = stored.taxInr + 0.01;
    const result = reconcile(items, stored);
    expect(result.ok).toBe(false);
  });

  it("names every field that disagrees", () => {
    const result = reconcile(items, {
      subtotalInr: 1,
      taxRate: 18,
      taxInr: 2,
      totalInr: 3,
    });
    if (result.ok) throw new Error("unreachable");
    expect(result.differences).toHaveLength(3);
  });
});

describe("isExpired", () => {
  it("treats the validity date as valid for its whole local day", () => {
    const validUntil = new Date("2026-09-30T00:00:00+05:30");
    // 23:00 IST on the 30th — still the 30th, so still valid.
    expect(isExpired(validUntil, new Date("2026-09-30T17:30:00Z"))).toBe(false);
  });

  it("expires on the next local day", () => {
    const validUntil = new Date("2026-09-30T00:00:00+05:30");
    expect(isExpired(validUntil, new Date("2026-10-01T04:00:00Z"))).toBe(true);
  });

  it("does not expire early because UTC rolled over first", () => {
    // 01:00 IST on the 30th is 19:30 UTC on the 29th. A naive UTC comparison
    // against an end-of-day timestamp gets this wrong in one direction or the
    // other; the local-day comparison does not.
    const validUntil = new Date("2026-09-30T00:00:00+05:30");
    expect(isExpired(validUntil, new Date("2026-09-29T19:30:00Z"))).toBe(false);
  });

  it("never expires without a validity date", () => {
    expect(isExpired(null)).toBe(false);
  });

  it("accepts an ISO string", () => {
    expect(isExpired("2026-01-01T00:00:00+05:30", new Date("2026-06-01T00:00:00Z"))).toBe(true);
  });
});

describe("daysUntilExpiry", () => {
  const tz = "Asia/Kolkata";

  it("counts whole local days", () => {
    expect(
      daysUntilExpiry("2026-09-30T00:00:00+05:30", new Date("2026-09-25T06:00:00Z"), tz)
    ).toBe(5);
  });

  it("is zero on the last valid day, not a fraction", () => {
    expect(
      daysUntilExpiry("2026-09-30T00:00:00+05:30", new Date("2026-09-30T17:00:00Z"), tz)
    ).toBe(0);
  });

  it("goes negative once past", () => {
    expect(
      daysUntilExpiry("2026-09-30T00:00:00+05:30", new Date("2026-10-02T06:00:00Z"), tz)
    ).toBe(-2);
  });

  it("is null with no validity date", () => {
    expect(daysUntilExpiry(null)).toBeNull();
  });
});

describe("localDateKey", () => {
  it("uses the given timezone, not the host's", () => {
    // 19:00 UTC is already the next day in Kolkata.
    const at = new Date("2026-09-22T19:00:00Z");
    expect(localDateKey(at, "Asia/Kolkata")).toBe("2026-09-23");
    expect(localDateKey(at, "UTC")).toBe("2026-09-22");
  });
});
