import { DEFAULT_WEIGHTS, scoreLead, type ScoringIcp, type ScoringWeights, type Dimension } from "@/lib/scoring";

/**
 * An opportunity's fit, from the same `scoreLead` fit rules a lead is scored with, so a company
 * reads the same fit on the opportunity and on its lead. Used at discovery and again whenever
 * research fills in the company. Pure.
 */
export function fitEvidenceFor(icp: ScoringIcp | null, company: { name: string; industry: string | null; city: string | null; state: string | null; employeeCount: number | null; technologies?: string[] }, weights: ScoringWeights = DEFAULT_WEIGHTS, now = new Date()) {
  if (!icp) return [];
  return scoreLead({ icp, company: { ...company, technologies: company.technologies ?? [] }, role: { title: "", seniority: null, department: null, isDecisionMaker: false }, signals: [], contacts: [], engagement: { outboundCount: 0, inboundCount: 0, repliedAt: null, meetingsHeld: 0, proposalViews: 0 }, budget: { estimatedInr: null }, now }, weights).evidence.filter(e => e.dimension === "fit");
}

/** The weighted composite over stored dimensions, the same formula `scoreOpportunity` uses. */
export function compositeOf(dimensions: Partial<Record<Dimension, number>>, weights: ScoringWeights = DEFAULT_WEIGHTS) {
  const total = Object.values(weights).reduce((a, b) => a + Math.max(0, b), 0);
  return total ? Math.round(Object.entries(weights).reduce((n, [k, w]) => n + (dimensions[k as Dimension] ?? 0) * Math.max(0, w), 0) / total) : 0;
}
