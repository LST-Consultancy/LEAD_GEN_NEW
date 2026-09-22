import { describe, expect, it } from "vitest";
import { healthOf, resolveSteps } from "@/lib/playbooks/steps";

const TOOLS = [
  { name: "add_note", implemented: true },
  { name: "draft_outreach", implemented: false },
  { name: "research_company", implemented: false },
];

describe("resolveSteps", () => {
  it("classifies control flow, built, unbuilt and unknown separately", () => {
    const steps = resolveSteps(
      [
        { order: 2, action: "add_note" },
        { order: 1, action: "wait" },
        { order: 3, action: "draft_outreach" },
        { order: 4, action: "identify_crm_owner" },
      ],
      TOOLS
    );

    // Sorted by order regardless of input order, since the sequence is the
    // whole meaning of a playbook.
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3, 4]);
    expect(steps.map((s) => s.status)).toEqual(["control", "built", "unbuilt", "unknown"]);
  });

  it("gives every step a reason", () => {
    const steps = resolveSteps([{ order: 1, action: "nope" }], TOOLS);
    expect(steps[0].reason).toMatch(/no tool by this name/i);
  });
});

describe("healthOf", () => {
  it("marks a playbook inert when nothing would act", () => {
    const health = healthOf(
      resolveSteps(
        [
          { order: 1, action: "research_company" },
          { order: 2, action: "draft_outreach" },
        ],
        TOOLS
      )
    );
    expect(health.inert).toBe(true);
    expect(health.blockedBecause).toContain("research_company");
  });

  it("treats a playbook of only waits as inert, not as working", () => {
    const health = healthOf(resolveSteps([{ order: 1, action: "wait" }], TOOLS));
    // A wait runs, but the playbook still does nothing — reporting it as
    // healthy is how an automation looks live while achieving nothing.
    expect(health.inert).toBe(true);
    expect(health.runnable).toBe(1);
  });

  it("names the step it would stop at when only part is built", () => {
    const health = healthOf(
      resolveSteps(
        [
          { order: 1, action: "add_note" },
          { order: 2, action: "draft_outreach" },
        ],
        TOOLS
      )
    );
    expect(health.inert).toBe(false);
    expect(health.blockedBecause).toContain("step 2");
    expect(health.blockedBecause).toContain("draft_outreach");
  });

  it("reports no blocker when every step is built", () => {
    const health = healthOf(
      resolveSteps(
        [
          { order: 1, action: "wait" },
          { order: 2, action: "add_note" },
        ],
        TOOLS
      )
    );
    expect(health.inert).toBe(false);
    expect(health.blockedBecause).toBeNull();
  });

  it("says so rather than throwing when a playbook has no steps", () => {
    const health = healthOf(resolveSteps([], TOOLS));
    expect(health.inert).toBe(true);
    expect(health.blockedBecause).toMatch(/no steps/i);
  });
});
