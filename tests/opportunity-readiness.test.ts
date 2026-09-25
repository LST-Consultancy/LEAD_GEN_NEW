import { describe, expect, it } from "vitest";
import { explainFit, readinessOf } from "@/lib/opportunities/readiness";
import { compositeOf, fitEvidenceFor } from "@/lib/opportunities/fit";

const icp = { name: "IT services SMBs", industries: ["IT Services"], locations: ["Pune"], employeeMin: 10, employeeMax: 200, technologies: [] };
const unknownCo = { industry: null, city: null, state: null, country: "Unknown", employeeCount: null };

describe("explaining fit", () => {
  it("calls zero with no ICP 'not assessed', never a poor fit", () => {
    expect(explainFit(null, unknownCo, 0, [])).toMatchObject({ state: "no_icp", headline: expect.stringContaining("not a poor fit") });
  });
  it("says fit is unassessed when every ICP criterion is unknown for the company, and names them", () => {
    const f = explainFit(icp, unknownCo, 0, []);
    expect(f.state).toBe("unassessed");
    expect(f.headline).toMatch(/industry, company size, location are unknown/);
    expect(f.headline).toContain("Research company");
  });
  it("marks a score computed from part of the evidence as partial, listing what is still unknown", () => {
    const f = explainFit(icp, { ...unknownCo, industry: "IT Services and IT Consulting" }, 34, [{ points: 34, label: "Industry matches your ICP" }]);
    expect(f.state).toBe("partial");
    expect(f.unknown).toHaveLength(2);
    expect(f.lines).toEqual([{ points: 34, label: "Industry matches your ICP" }]);
  });
  it("treats 'Unknown' text as unknown, not as a location", () => {
    expect(explainFit(icp, { ...unknownCo, city: "Unknown", industry: "IT Services", employeeCount: 45 }, 60, []).unknown.join(" ")).toContain("location");
  });
});

describe("fit uses the lead scoring rules", () => {
  it("scores the same company fields the same way, and composite follows the weights", () => {
    const ev = fitEvidenceFor({ ...icp, buyerRoles: [], seniorities: [], pains: [], triggerEvents: [], exclusions: [] } as never, { name: "Atzean", industry: "IT Services and IT Consulting", city: "Pune", state: null, employeeCount: 45 });
    expect(ev.reduce((n, e) => n + e.points, 0)).toBe(34 + 20 + 26);
    expect(fitEvidenceFor(null, { name: "x", industry: null, city: null, state: null, employeeCount: null })).toEqual([]);
    expect(compositeOf({ fit: 100 }, { fit: 1, intent: 1, urgency: 0, authority: 0, budget: 0, reachability: 0, engagement: 0, recency: 0 })).toBe(50);
  });
});

describe("readiness", () => {
  it("keeps the four stages independent", () => {
    const r = readinessOf({ qualified: true, qualifiedWhy: "q", companyResolved: false, researchedWhy: "r", reachablePeople: 0, peopleFound: 3, leads: 1 });
    expect(r.map(s => [s.key, s.done])).toEqual([["qualified", true], ["researched", false], ["contact_ready", false], ["in_crm", true]]);
    expect(r[2].detail).toContain("3 people found, none with a usable company address");
  });
});
