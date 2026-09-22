import { describe, expect, it } from "vitest";
import {
  formatInr,
  formatInrCompact,
  formatAge,
  formatNumber,
  daysBetween,
  greeting,
  formatRelative,
  hoursSince,
  isPast,
  stableNow,
} from "@/lib/format";

describe("INR formatting — Indian numbering conventions", () => {
  it("groups in the 2,2,3 pattern", () => {
    expect(formatNumber(1234567)).toBe("12,34,567");
    expect(formatNumber(100000)).toBe("1,00,000");
  });

  it("formats lakh and crore compactly", () => {
    expect(formatInrCompact(4280000)).toBe("₹42.8L");
    expect(formatInrCompact(12400000)).toBe("₹1.24Cr");
    expect(formatInrCompact(100000)).toBe("₹1L");
    expect(formatInrCompact(10000000)).toBe("₹1Cr");
  });

  it("falls back to grouped rupees below a lakh", () => {
    expect(formatInrCompact(8400)).toBe("₹8,400");
    expect(formatInrCompact(950)).toBe("₹950");
  });

  it("keeps the sign on negative amounts", () => {
    expect(formatInrCompact(-4280000)).toBe("-₹42.8L");
  });

  it("trims trailing zeros rather than printing ₹42.80L", () => {
    expect(formatInrCompact(4200000)).toBe("₹42L");
    expect(formatInrCompact(4250000)).toBe("₹42.5L");
  });

  it("renders a full currency string with the rupee symbol", () => {
    expect(formatInr(2499)).toContain("2,499");
    expect(formatInr(2499)).toContain("₹");
  });
});

describe("formatAge — stable across a hydration boundary", () => {
  const base = new Date("2026-06-15T12:00:30.000Z");

  it("produces the same output for any instant within a minute", () => {
    // Server and client render at different milliseconds; both must agree, or
    // React reports a hydration mismatch.
    const subject = new Date("2026-06-15T11:58:00.000Z");
    const early = formatAge(subject, new Date("2026-06-15T12:00:00.100Z"));
    const late = formatAge(subject, new Date("2026-06-15T12:00:59.900Z"));
    expect(early).toBe(late);
  });

  it("describes ages at each scale", () => {
    expect(formatAge(new Date("2026-06-15T12:00:10.000Z"), base)).toBe("just now");
    expect(formatAge(new Date("2026-06-15T11:45:00.000Z"), base)).toBe("15m ago");
    expect(formatAge(new Date("2026-06-15T08:00:00.000Z"), base)).toBe("4h ago");
    expect(formatAge(new Date("2026-06-10T12:00:00.000Z"), base)).toBe("5d ago");
    expect(formatAge(new Date("2026-04-15T12:00:00.000Z"), base)).toBe("2mo ago");
    expect(formatAge(new Date("2024-06-15T12:00:00.000Z"), base)).toBe("2y ago");
  });

  it("renders an em dash for a missing date", () => {
    expect(formatAge(null)).toBe("—");
  });

  it("never reports a negative age for a future date", () => {
    expect(formatAge(new Date("2026-06-20T12:00:00.000Z"), base)).toBe("just now");
  });
});

describe("daysBetween", () => {
  it("counts whole days regardless of argument order", () => {
    const a = new Date("2026-06-01T00:00:00Z");
    const b = new Date("2026-06-15T00:00:00Z");
    expect(daysBetween(a, b)).toBe(14);
    expect(daysBetween(b, a)).toBe(14);
  });
});

describe("greeting", () => {
  it("tracks the time of day in the given timezone", () => {
    // 04:00 UTC is 09:30 in Kolkata.
    expect(greeting(new Date("2026-06-15T04:00:00Z"), "Asia/Kolkata")).toBe("Good morning");
    // 09:00 UTC is 14:30 in Kolkata.
    expect(greeting(new Date("2026-06-15T09:00:00Z"), "Asia/Kolkata")).toBe("Good afternoon");
    // 15:00 UTC is 20:30 in Kolkata.
    expect(greeting(new Date("2026-06-15T15:00:00Z"), "Asia/Kolkata")).toBe("Good evening");
  });
});

describe("formatRelative — describes the future as well as the past", () => {
  const base = new Date("2026-06-15T12:00:00.000Z");

  it("reads forward for an upcoming time", () => {
    // formatAge clamps a future date to "just now", which is wrong for a
    // scheduled next-run time.
    expect(formatRelative(new Date("2026-06-15T15:00:00.000Z"), base)).toMatch(/in 3 hours/);
    expect(formatRelative(new Date("2026-06-16T12:00:00.000Z"), base)).toMatch(/tomorrow|in 1 day/);
  });

  it("reads backward for a past time", () => {
    expect(formatRelative(new Date("2026-06-15T09:00:00.000Z"), base)).toMatch(/3 hours ago/);
  });
});

describe("stable time helpers — SSR and hydration must agree", () => {
  it("floors the reference to the start of the minute", () => {
    const a = stableNow(new Date("2026-06-15T12:00:00.001Z"));
    const b = stableNow(new Date("2026-06-15T12:00:59.999Z"));
    expect(a).toBe(b);
    expect(new Date(a).getSeconds()).toBe(0);
    expect(new Date(a).getMilliseconds()).toBe(0);
  });

  it("hoursSince returns whole hours and never goes negative", () => {
    const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000);
    expect(hoursSince(fourHoursAgo)).toBe(4);
    expect(hoursSince(new Date(Date.now() + 3_600_000))).toBe(0);
    expect(Number.isInteger(hoursSince(fourHoursAgo))).toBe(true);
  });

  it("isPast is stable within a minute and handles null", () => {
    expect(isPast(null)).toBe(false);
    expect(isPast(new Date(Date.now() - 120_000))).toBe(true);
    expect(isPast(new Date(Date.now() + 120_000))).toBe(false);
  });
});
