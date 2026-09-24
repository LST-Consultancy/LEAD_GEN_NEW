import { describe, expect, it } from "vitest";
import { angle, authorityState, readinessSummary, risks, whyFit } from "@/lib/leads/assessment";

const strong = { fit: 80, intent: 70, urgency: 40, authority: 70, budget: 60, reachability: 80, engagement: 20, recency: 80 };

describe("evidence-free assessments", () => {
  it("never calls an unscored lead all-evidenced", () => {
    const text = risks({}, [], false, null);
    expect(text).not.toMatch(/all evidenced/);
    expect(text).toMatch(/budget, authority, need, reachability have not been assessed/i);
  });
  it("reports a single missing dimension as unknown rather than passing it", () => {
    const { budget: _b, ...noBudget } = strong;
    expect(risks(noBudget, [], true, null)).toMatch(/budget has not been assessed/i);
  });
  it("gives the all-clear only when every dimension is present and passing", () => {
    expect(risks(strong, [], true, null)).toMatch(/all evidenced/);
    expect(risks({ ...strong, budget: 10 }, [], true, null)).toMatch(/no budget has been confirmed/i);
  });
  it("does not treat a stated budget as needing a budget score", () => {
    const { budget: _b, ...noBudget } = strong;
    expect(risks(noBudget, [], true, 500000)).toMatch(/all evidenced/);
  });
  it("renders an empty readiness list as not assessed, never success", () => {
    expect(readinessSummary([])).toEqual({ label: "Not assessed", tone: "neutral", assessed: false });
    expect(readinessSummary([{ state: "no" }]).tone).toBe("neutral");
    expect(readinessSummary([{ state: "yes" }, { state: "yes" }, { state: "no" }]).tone).toBe("success");
  });
  it("derives one authority state so the badge and verdict cannot disagree", () => {
    expect(authorityState({}, true)).toBe("title_only");
    expect(whyFit({}, "title_only")).toMatch(/title suggests .* nobody has confirmed/);
    expect(authorityState({ authority: 60 }, false)).toBe("influencer");
    expect(authorityState({}, false)).toBe("unknown");
    expect(whyFit({}, "unknown")).toMatch(/ICP fit has not been assessed.*unknown/);
  });
  it("offers no angle for an unscored lead", () => {
    expect(angle({}, "x")).toMatch(/not been scored/);
  });
});
