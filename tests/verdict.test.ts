import { describe, expect, it } from "vitest";
import { containsInventedNumber } from "@/lib/ai/verdict";

/**
 * The guarantee that makes this feature safe to ship: the model explains the
 * scores, it never states one.
 *
 * A prompt instruction is a request. This is the check that makes it a rule,
 * so these tests are about what gets through and what does not.
 */
describe("containsInventedNumber", () => {
  const allowed = [82, 41, 7.4, 100, 600];

  it("passes text that only quotes the computed figures", () => {
    expect(
      containsInventedNumber("ICP Fit is 82 and Authority is 41, giving 7.4 overall.", allowed)
    ).toBeNull();
  });

  it("catches a figure that was never computed", () => {
    // The whole point: a plausible-looking number nobody can trace.
    expect(containsInventedNumber("Intent is around 63, which is mid-range.", allowed)).toBe("63");
  });

  it("catches an invented percentage", () => {
    expect(containsInventedNumber("They are 78% likely to convert.", allowed)).toBe("78");
  });

  it("catches an averaged figure the model worked out itself", () => {
    // (82 + 41) / 2 = 61.5 — arithmetic the model was told not to do.
    expect(containsInventedNumber("The two together average 61.5.", allowed)).toBe("61.5");
  });

  it("allows small integers, which are counting words", () => {
    expect(
      containsInventedNumber("Two dimensions explain most of it, and 3 are weak.", allowed)
    ).toBeNull();
  });

  it("allows a rounded form of an allowed value", () => {
    // 7.4 given, "7" written. Same number, differently rendered.
    expect(containsInventedNumber("Overall it sits at 7.", allowed)).toBeNull();
  });

  it("allows a one-decimal form of an allowed integer", () => {
    expect(containsInventedNumber("Fit is 82.0.", allowed)).toBeNull();
  });

  it("ignores numbers written as words", () => {
    // The rule is about figures presented as data, not about prose.
    expect(
      containsInventedNumber("Authority is the weakest of the eight dimensions.", allowed)
    ).toBeNull();
  });

  it("returns the first offender, so the message can name it", () => {
    expect(containsInventedNumber("Scores of 55 and 66 were seen.", allowed)).toBe("55");
  });

  it("copes with no allowed values at all", () => {
    expect(containsInventedNumber("It scores 45.", [])).toBe("45");
    expect(containsInventedNumber("No figures here.", [])).toBeNull();
  });

  it("ignores a non-finite allowed value rather than throwing", () => {
    // `employeeCount` is NaN when a company has none recorded.
    expect(containsInventedNumber("Headcount 600 is mid-market.", [Number.NaN, 600])).toBeNull();
  });

  it("does not treat a year or an id as permitted by accident", () => {
    expect(containsInventedNumber("Since 2019 they have grown.", allowed)).toBe("2019");
  });
});
