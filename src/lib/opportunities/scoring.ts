import { DEFAULT_WEIGHTS, type ScoringWeights, type Dimension } from "@/lib/scoring";
import type { extractOpportunity, SourceDocument } from "./extractor";
export const DEFAULT_RULES = { vendor: 30, requirement: 20, rfp: 35, hiring: 10, technology: 10, implementation: 15, integration: 12, migration: 12, recent: 20 };
export function recency(postedAt: string | null, now: Date) {
  if (!postedAt) return { score: 0, label: "Unknown", days: null };
  const days = Math.floor((now.getTime() - new Date(postedAt).getTime()) / 86400000);
  if (!Number.isFinite(days) || days < 0) return { score: 0, label: "Unknown", days: null };
  return { days, ...(days <= 3 ? { score: 100, label: "Very recent" } : days <= 7 ? { score: 85, label: "Recent" } : days <= 14 ? { score: 65, label: "Active" } : days <= 30 ? { score: 40, label: "Aging" } : days <= 90 ? { score: 15, label: "Old" } : { score: 5, label: "Historical" }) };
}
export function scoreOpportunity(ex: ReturnType<typeof extractOpportunity>, doc: SourceDocument, now = new Date(), weights: ScoringWeights = DEFAULT_WEIGHTS, overrides: Partial<typeof DEFAULT_RULES> = {}, fitEvidence: { points: number; label: string }[] = []) {
  const rules = { ...DEFAULT_RULES, ...overrides };
  const evidence: { type: string; description: string; scoreContribution: number; confidence: number }[] = [];
  const add = (type: string, description: string, points: number) => evidence.push({ type, description, scoreContribution: points, confidence: 80 });
  if (ex.isExternalVendorOpportunity) add("vendor", "Explicit external vendor requirement", rules.vendor);
  if (ex.isInternalHiring) add("hiring", "Internal hiring; external purchasing is not established", rules.hiring);
  if (ex.isProjectRequirement && !ex.isInternalHiring) add("requirement", "Requirement language in source", rules.requirement);
  if (ex.opportunityTypes.includes("RFP")) add("rfp", "Published request for proposals", rules.rfp);
  if (ex.technologies.length) add("technology", "Requested technology mentioned in source", rules.technology);
  if (!ex.isInternalHiring || ex.isExternalVendorOpportunity) for (const k of ["implementation", "integration", "migration"] as const) if (ex.opportunityTypes.includes(k.toUpperCase() as "IMPLEMENTATION")) add(k, `${k} requirement`, rules[k]);
  const age = recency(ex.postedAt, now);
  if (age.days !== null && age.days <= 3 && ex.isProjectRequirement) add("recent", "Source posting date within three days", rules.recent);
  if (!ex.isProjectRequirement) add("weak", "Keyword mention only; no actual requirement established", -20);
  if (["CLOSED", "EXPIRED", "AWARDED", "CANCELLED"].includes(doc.status ?? "")) add("closed", "Source reports this requirement is no longer open", -100);
  if (age.days !== null && age.days > 30) add("old", "Older source evidence; current need is uncertain", -15);
  const sum = evidence.reduce((a, b) => a + b.scoreContribution, 0);
  const intent = Math.max(0, Math.min(ex.isInternalHiring && !ex.isExternalVendorOpportunity ? 40 : 100, sum));
  if (intent !== sum) add("normalization", "Applied score bounds and internal-hiring cap", intent - sum);
  const dimensions: Record<Dimension, number> = { fit: Math.min(100, fitEvidence.reduce((n,e) => n+e.points, 0)), intent, urgency: ex.urgency === "HIGH" ? 70 : ex.timelineMentioned ? 40 : 0, authority: 0, budget: ex.budgetMentioned ? 40 : 0, reachability: 0, recency: age.score, engagement: 0 };
  const total = Object.values(weights).reduce((a, b) => a + Math.max(0, b), 0);
  const composite = total ? Math.round(Object.entries(dimensions).reduce((n, [k, v]) => n + v * Math.max(0, weights[k as Dimension]), 0) / total) : 0;
  return { fitEvidence, intentScore: intent, fitScore: dimensions.fit, opportunityScore: composite, dimensions, recency: age, evidence };
}
