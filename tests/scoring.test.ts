import { describe, expect, it } from "vitest";
import {
  scoreLead,
  tierFor,
  intentLevelFor,
  DEFAULT_WEIGHTS,
  type ScoringInput,
} from "@/lib/scoring";

const NOW = new Date("2026-06-15T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const ICP: ScoringInput["icp"] = {
  industries: ["Manufacturing"],
  locations: ["Maharashtra", "Pune"],
  employeeMin: 100,
  employeeMax: 2000,
  buyerRoles: ["Head of IT", "CTO"],
  seniorities: ["head", "c-level"],
  technologies: ["SAP ECC"],
  triggerEvents: ["erp modernisation"],
  exclusions: ["staffing"],
};

function input(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    icp: ICP,
    company: {
      name: "Acme Manufacturing",
      industry: "Manufacturing",
      city: "Pune",
      state: "Maharashtra",
      employeeCount: 500,
      technologies: ["SAP ECC"],
    },
    role: {
      title: "Head of IT",
      seniority: "head",
      department: "Technology",
      isDecisionMaker: true,
    },
    signals: [],
    contacts: [],
    engagement: {
      outboundCount: 0,
      inboundCount: 0,
      repliedAt: null,
      meetingsHeld: 0,
      proposalViews: 0,
    },
    budget: { estimatedInr: null },
    now: NOW,
    ...overrides,
  };
}

describe("scoreLead — dimensions are independent and evidenced", () => {
  it("scores a perfect ICP match highly on fit and cites each reason", () => {
    const r = scoreLead(input());
    expect(r.dimensions.fit).toBeGreaterThanOrEqual(80);

    const fitEvidence = r.evidence.filter((e) => e.dimension === "fit");
    expect(fitEvidence.map((e) => e.label)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Industry matches"),
        expect.stringContaining("target region"),
        expect.stringContaining("Company size fits"),
        expect.stringContaining("technology you target"),
      ])
    );
  });

  it("penalises an ICP exclusion match", () => {
    const withExclusion = scoreLead(
      input({
        company: {
          name: "Acme Staffing Partners",
          industry: "Staffing",
          city: "Pune",
          state: "Maharashtra",
          employeeCount: 500,
          technologies: [],
        },
      })
    );
    expect(withExclusion.dimensions.fit).toBeLessThan(scoreLead(input()).dimensions.fit);
    expect(withExclusion.evidence.some((e) => e.points < 0 && /exclusion/i.test(e.label))).toBe(
      true
    );
  });

  it("gives zero intent and says so when no signal exists", () => {
    const r = scoreLead(input());
    expect(r.dimensions.intent).toBe(0);
    expect(r.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "intent", label: "No buying signal detected yet" }),
      ])
    );
  });

  it("ranks one strong recent signal above many weak old ones", () => {
    const strong = scoreLead(
      input({
        signals: [
          {
            type: "RFP",
            occurredAt: daysAgo(1),
            confidence: 95,
            keywords: ["rfp", "erp"],
            excerpt: "Request for proposals: ERP modernisation",
          },
        ],
      })
    );
    const manyWeak = scoreLead(
      input({
        signals: Array.from({ length: 6 }, () => ({
          type: "WEBSITE_UPDATE" as const,
          occurredAt: daysAgo(40),
          confidence: 50,
          keywords: ["hiring"],
          excerpt: "Added a careers page",
        })),
      })
    );
    expect(strong.dimensions.intent).toBeGreaterThan(manyWeak.dimensions.intent);
  });

  it("decays intent as a signal ages", () => {
    const signal = {
      type: "SOCIAL_POST" as const,
      confidence: 90,
      keywords: ["salesforce"],
      excerpt: "Shortlisting Salesforce partners",
    };
    const fresh = scoreLead(input({ signals: [{ ...signal, occurredAt: daysAgo(1) }] }));
    const stale = scoreLead(input({ signals: [{ ...signal, occurredAt: daysAgo(60) }] }));
    expect(fresh.dimensions.intent).toBeGreaterThan(stale.dimensions.intent);
    expect(fresh.dimensions.recency).toBeGreaterThan(stale.dimensions.recency);
  });

  it("raises urgency when the evidence names a timeline", () => {
    const withDeadline = scoreLead(
      input({
        signals: [
          {
            type: "SOCIAL_POST",
            occurredAt: daysAgo(1),
            confidence: 90,
            keywords: ["this quarter"],
            excerpt: "We want deployment completed this quarter",
          },
        ],
      })
    );
    const withoutDeadline = scoreLead(
      input({
        signals: [
          {
            type: "SOCIAL_POST",
            occurredAt: daysAgo(1),
            confidence: 90,
            keywords: ["crm"],
            excerpt: "Thinking about our CRM someday",
          },
        ],
      })
    );
    expect(withDeadline.dimensions.urgency).toBeGreaterThan(withoutDeadline.dimensions.urgency);
  });

  it("zeroes reachability and records the reason when the person opted out", () => {
    const r = scoreLead(
      input({
        contacts: [
          { kind: "WORK_EMAIL", status: "VERIFIED", isLocked: false, optedOut: true },
        ],
      })
    );
    expect(r.dimensions.reachability).toBe(0);
    expect(r.evidence.some((e) => /opted out/i.test(e.label))).toBe(true);
  });

  it("rates a verified email above an unverified one", () => {
    const verified = scoreLead(
      input({
        contacts: [{ kind: "WORK_EMAIL", status: "VERIFIED", isLocked: false, optedOut: false }],
      })
    );
    const unverified = scoreLead(
      input({
        contacts: [{ kind: "WORK_EMAIL", status: "UNVERIFIED", isLocked: false, optedOut: false }],
      })
    );
    expect(verified.dimensions.reachability).toBeGreaterThan(unverified.dimensions.reachability);
  });

  it("penalises repeated outreach that got no response", () => {
    const ignored = scoreLead(
      input({
        engagement: {
          outboundCount: 6,
          inboundCount: 0,
          repliedAt: null,
          meetingsHeld: 0,
          proposalViews: 0,
        },
      })
    );
    expect(ignored.evidence.some((e) => e.dimension === "engagement" && e.points < 0)).toBe(true);
  });

  it("says no budget is confirmed even when headcount implies capacity", () => {
    // 500 employees earns a capacity proxy, but that is not approved spend, so
    // the explainer must still say the budget is unconfirmed.
    const r = scoreLead(input());
    expect(r.dimensions.budget).toBeGreaterThan(0);
    expect(
      r.evidence.some((e) => e.dimension === "budget" && e.label === "No budget confirmed")
    ).toBe(true);
  });

  it("drops the unconfirmed-budget note once there is direct evidence", () => {
    const r = scoreLead(input({ budget: { estimatedInr: 2_500_000 } }));
    expect(
      r.evidence.some((e) => e.dimension === "budget" && e.label === "No budget confirmed")
    ).toBe(false);
  });

  it("keeps every dimension within 0-100", () => {
    const maximal = scoreLead(
      input({
        signals: Array.from({ length: 5 }, (_, i) => ({
          type: "RFP" as const,
          occurredAt: daysAgo(i),
          confidence: 99,
          keywords: ["rfp", "this quarter", "budget approved"],
          excerpt: "RFP: ERP modernisation this quarter, budget approved",
        })),
        contacts: [
          { kind: "WORK_EMAIL", status: "VERIFIED", isLocked: false, optedOut: false },
          { kind: "MOBILE", status: "VERIFIED", isLocked: false, optedOut: false },
          { kind: "LINKEDIN_URL", status: "LIKELY", isLocked: false, optedOut: false },
        ],
        engagement: {
          outboundCount: 3,
          inboundCount: 4,
          repliedAt: daysAgo(1),
          meetingsHeld: 3,
          proposalViews: 9,
        },
        budget: { estimatedInr: 5_000_000 },
      })
    );
    for (const [key, value] of Object.entries(maximal.dimensions)) {
      expect(value, `${key} out of range`).toBeGreaterThanOrEqual(0);
      expect(value, `${key} out of range`).toBeLessThanOrEqual(100);
    }
    expect(maximal.composite).toBeLessThanOrEqual(100);
    expect(maximal.displayScore).toBeLessThanOrEqual(10);
  });

  it("is deterministic — the same input always yields the same score", () => {
    const a = scoreLead(input());
    const b = scoreLead(input());
    expect(a.composite).toBe(b.composite);
    expect(a.evidence).toEqual(b.evidence);
  });

  it("recomputes the composite when weights change", () => {
    const base = input({
      signals: [
        {
          type: "RFP",
          occurredAt: daysAgo(1),
          confidence: 95,
          keywords: ["rfp"],
          excerpt: "RFP published",
        },
      ],
    });
    const intentHeavy = scoreLead(base, { ...DEFAULT_WEIGHTS, intent: 60, fit: 5 });
    const fitHeavy = scoreLead(base, { ...DEFAULT_WEIGHTS, intent: 5, fit: 60 });
    expect(intentHeavy.composite).not.toBe(fitHeavy.composite);
    // Dimensions are stored independently of the weighting.
    expect(intentHeavy.dimensions).toEqual(fitHeavy.dimensions);
  });
});

describe("tierFor", () => {
  it.each([
    [95, "A"],
    [80, "A"],
    [79, "B"],
    [60, "B"],
    [59, "C"],
    [40, "C"],
    [39, "D"],
    [0, "D"],
  ])("maps composite %i to tier %s", (composite, tier) => {
    expect(tierFor(composite)).toBe(tier);
  });

  it("honours configured cutoffs", () => {
    expect(tierFor(70, { a: 65, b: 50, c: 30 })).toBe("A");
  });
});

describe("intentLevelFor", () => {
  it("reserves BUYING for the strongest evidence", () => {
    expect(intentLevelFor(0, 0, false)).toBe("COLD");
    expect(intentLevelFor(20, 20, false)).toBe("AWARE");
    expect(intentLevelFor(45, 40, false)).toBe("WARM");
    expect(intentLevelFor(65, 60, false)).toBe("HOT");
    expect(intentLevelFor(85, 80, false)).toBe("BUYING");
  });

  it("lets a reply promote a strong lead to BUYING", () => {
    expect(intentLevelFor(70, 70, false)).toBe("HOT");
    expect(intentLevelFor(70, 70, true)).toBe("BUYING");
  });

  it("does not let a reply alone promote a weak lead", () => {
    expect(intentLevelFor(20, 20, false)).toBe("AWARE");
    expect(intentLevelFor(20, 20, true)).toBe("AWARE");
    expect(intentLevelFor(10, 10, true)).toBe("COLD");
  });
});
