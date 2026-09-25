import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { leadVisibilityFilter, type AuthContext } from "@/lib/auth/context";
import { DEFAULT_WEIGHTS, type ScoringWeights } from "@/lib/scoring";
import { compositeOf, fitEvidenceFor } from "@/lib/opportunities/fit";
import { explainFit, readinessOf } from "@/lib/opportunities/readiness";
import { getOpportunity } from "./opportunities";

const CLOSED = ["CLOSED", "EXPIRED", "AWARDED", "CANCELLED"];

async function weightsFor(workspaceId: string): Promise<ScoringWeights> {
  const c = await db.scoringConfig.findUnique({ where: { workspaceId } });
  return c ? { fit: c.fitWeight, intent: c.intentWeight, urgency: c.urgencyWeight, authority: c.authorityWeight, budget: c.budgetWeight, reachability: c.reachabilityWeight, engagement: c.engagementWeight, recency: c.recencyWeight } : DEFAULT_WEIGHTS;
}

/**
 * Recomputes an opportunity's fit once research has filled in its company, with the same rules as
 * at discovery. A pure recomputation, so running it twice changes nothing the second time.
 */
export async function refreshOpportunityFit(workspaceId: string, opportunityId: string) {
  const o = await db.opportunity.findFirst({ where: { id: opportunityId, workspaceId, deletedAt: null }, include: { company: true } });
  if (!o) return null;
  const [icp, weights] = await Promise.all([db.icpProfile.findFirst({ where: { workspaceId, deletedAt: null, isPrimary: true } }), weightsFor(workspaceId)]);
  const evidence = fitEvidenceFor(icp, o.company, weights);
  const fit = Math.min(100, Math.max(0, evidence.reduce((n, e) => n + e.points, 0)));
  const scores = { ...((o.scores ?? {}) as Record<string, unknown>), fit, fitEvidence: evidence, fitAssessedAt: new Date().toISOString() };
  const opportunityScore = compositeOf(scores as unknown as Record<string, number>, weights);
  await db.opportunity.update({ where: { id: o.id }, data: { fitScore: fit, opportunityScore, scores: scores as Prisma.InputJsonValue } });
  return { fit, opportunityScore };
}

/** The fit explanation and the four readiness stages for the opportunity screen, each from rows. */
export async function getOpportunityReadiness(ctx: AuthContext, opportunityId: string) {
  const o = await getOpportunity(ctx, opportunityId);
  const company = await db.company.findFirstOrThrow({ where: { id: o.companyId, workspaceId: ctx.workspaceId } });
  const icp = await db.icpProfile.findFirst({ where: { workspaceId: ctx.workspaceId, deletedAt: null, isPrimary: true } });
  const scores = (o.scores ?? {}) as { fitEvidence?: { points: number; label: string }[] };
  const fit = explainFit(icp ? { name: icp.name, industries: icp.industries, locations: icp.locations, employeeMin: icp.employeeMin, employeeMax: icp.employeeMax, technologies: icp.technologies } : null, company, o.fitScore, (scores.fitEvidence ?? []).map(e => ({ points: e.points, label: e.label })));
  const jobs = await db.employment.findMany({ where: { workspaceId: ctx.workspaceId, companyId: company.id, isCurrent: true }, select: { personId: true } });
  const personIds = jobs.map(j => j.personId);
  const domains = [company.domain, ...(((company.enrichment ?? {}) as { emailDomains?: { domain: string; status: string }[] }).emailDomains ?? []).filter(d => d.status === "alias").map(d => d.domain)].filter((d): d is string => Boolean(d));
  const reachable = personIds.length && domains.length ? await db.contactMethod.findMany({
    where: { workspaceId: ctx.workspaceId, personId: { in: personIds }, kind: "WORK_EMAIL", status: { not: "FAILED" }, optedOutAt: null, verificationResult: { not: "INVALID" }, OR: domains.map(d => ({ value: { endsWith: `@${d}`, mode: "insensitive" as const } })) },
    select: { personId: true, value: true } }) : [];
  const suppressed = new Set((await db.suppression.findMany({ where: { workspaceId: ctx.workspaceId, value: { in: reachable.map(r => r.value ?? "").filter(Boolean), mode: "insensitive" } }, select: { value: true } })).map(s => s.value.toLowerCase()));
  const reachablePeople = new Set(reachable.filter(r => r.value && !suppressed.has(r.value.toLowerCase())).map(r => r.personId)).size;
  const urls = o.sources.map(s => s.sourceUrl);
  const leads = urls.length ? await db.lead.count({ where: { workspaceId: ctx.workspaceId, deletedAt: null, companyId: company.id, ...leadVisibilityFilter(ctx), signals: { some: { workspaceId: ctx.workspaceId, sourceUrl: { in: urls } } } } }) : 0;
  const resolved = Boolean(company.linkedinUrl || company.domain);
  const closed = CLOSED.includes(o.status);
  return {
    fit,
    stages: readinessOf({
      qualified: !closed, qualifiedWhy: closed ? `The source reports it as ${o.status.toLowerCase()}.` : `Kept as an opportunity from its source (intent ${o.intentScore}/100). Intent is about the request, not about the company.`,
      companyResolved: resolved, researchedWhy: resolved ? `Identified by ${[company.domain ? `website ${company.domain}` : null, company.linkedinUrl ? "LinkedIn page" : null].filter(Boolean).join(" and ")}.` : "The company's website and LinkedIn page are not known yet. Use Research company.",
      reachablePeople, peopleFound: personIds.length, leads,
    }),
  };
}
