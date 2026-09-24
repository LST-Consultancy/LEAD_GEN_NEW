import "server-only";
import { db } from "@/lib/db";
import { emitWebhookEvent } from "@/lib/services/webhook-events";
import {
  scoreLead,
  DEFAULT_WEIGHTS,
  intentLevelFor,
  tierFor,
  type ScoringSignal,
  type ScoringWeights,
} from "@/lib/scoring";

/**
 * Recomputes lead scores.
 *
 * This is what makes scoring live rather than a one-off seed artifact: recency
 * decays every day, so a lead that was hot last week should not still read hot
 * today. Running it nightly keeps the numbers honest without a human touching
 * anything.
 *
 * Idempotent by construction — the scoring engine is pure, so running twice on
 * unchanged inputs produces identical output.
 */

export type RescoreSummary = {
  workspaceId: string;
  leadsConsidered: number;
  leadsChanged: number;
  tierChanges: number;
  intentChanges: number;
  evidenceRows: number;
};

const BATCH = 200;

async function loadWeights(workspaceId: string): Promise<ScoringWeights> {
  const config = await db.scoringConfig.findUnique({ where: { workspaceId } });
  if (!config) return DEFAULT_WEIGHTS;
  return {
    fit: config.fitWeight,
    intent: config.intentWeight,
    urgency: config.urgencyWeight,
    authority: config.authorityWeight,
    budget: config.budgetWeight,
    reachability: config.reachabilityWeight,
    engagement: config.engagementWeight,
    recency: config.recencyWeight,
  };
}

async function loadCutoffs(workspaceId: string) {
  const config = await db.scoringConfig.findUnique({ where: { workspaceId } });
  return {
    a: config?.tierACutoff ?? 80,
    b: config?.tierBCutoff ?? 60,
    c: config?.tierCCutoff ?? 40,
  };
}

export async function rescoreWorkspace(
  workspaceId: string,
  opts: { leadIds?: string[] } = {}
): Promise<RescoreSummary> {
  const [weights, cutoffs] = await Promise.all([
    loadWeights(workspaceId),
    loadCutoffs(workspaceId),
  ]);
  const now = new Date();

  const summary: RescoreSummary = {
    workspaceId,
    leadsConsidered: 0,
    leadsChanged: 0,
    tierChanges: 0,
    intentChanges: 0,
    evidenceRows: 0,
  };

  let cursor: string | undefined;

  // Paged rather than loaded whole: a large workspace must not pull every lead
  // and its whole signal history into memory at once.
  for (;;) {
    const leads = await db.lead.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        discardedAt: null,
        ...(opts.leadIds?.length ? { id: { in: opts.leadIds } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        icpProfile: true,
        company: true,
        person: {
          include: {
            employments: { where: { isCurrent: true }, take: 1 },
            contactMethods: {
              select: { kind: true, status: true, isLocked: true, optedOutAt: true },
            },
          },
        },
        signals: {
          select: {
            id: true,
            type: true,
            occurredAt: true,
            confidence: true,
            keywords: true,
            excerpt: true,
          },
        },
        score: { select: { id: true, composite: true } },
        conversations: {
          select: {
            messages: { select: { direction: true, sentAt: true } },
          },
        },
        bookings: { select: { state: true } },
        proposals: { select: { viewCount: true } },
      },
    });

    if (leads.length === 0) break;
    cursor = leads[leads.length - 1].id;

    for (const lead of leads) {
      summary.leadsConsidered++;

      const icp = lead.icpProfile;
      if (!icp) continue;

      const employment = lead.person.employments[0];
      const messages = lead.conversations.flatMap((c) => c.messages);
      const outboundCount = messages.filter((m) => m.direction === "OUTBOUND" && m.sentAt).length;
      const inboundCount = messages.filter((m) => m.direction === "INBOUND").length;

      const signals: ScoringSignal[] = lead.signals.map((s) => ({
        id: s.id,
        type: s.type,
        occurredAt: s.occurredAt,
        confidence: s.confidence,
        keywords: s.keywords,
        excerpt: s.excerpt,
      }));

      const result = scoreLead(
        {
          icp: {
            industries: icp.industries,
            locations: icp.locations,
            employeeMin: icp.employeeMin,
            employeeMax: icp.employeeMax,
            buyerRoles: icp.buyerRoles,
            seniorities: icp.seniorities,
            technologies: icp.technologies,
            triggerEvents: icp.triggerEvents,
            exclusions: icp.exclusions,
          },
          company: {
            name: lead.company.name,
            industry: lead.company.industry,
            city: lead.company.city,
            state: lead.company.state,
            employeeCount: lead.company.employeeCount,
            technologies: lead.company.technologies,
          },
          role: {
            title: employment?.title ?? "Unknown",
            seniority: employment?.seniority ?? null,
            department: employment?.department ?? null,
            isDecisionMaker: employment?.isDecisionMaker ?? false,
          },
          signals,
          contacts: lead.person.contactMethods.map((c) => ({
            kind: c.kind,
            status: c.status,
            isLocked: c.isLocked,
            optedOut: c.optedOutAt !== null,
          })),
          engagement: {
            outboundCount,
            inboundCount,
            repliedAt: lead.repliedAt,
            meetingsHeld: lead.bookings.filter((b) => b.state === "completed").length,
            proposalViews: lead.proposals.reduce((s, p) => s + p.viewCount, 0),
          },
          budget: {
            estimatedInr: lead.estimatedBudgetInr ? Number(lead.estimatedBudgetInr) : null,
          },
          now,
        },
        weights
      );

      const tier = tierFor(result.composite, cutoffs);
      const intent = intentLevelFor(
        result.dimensions.intent,
        result.dimensions.urgency,
        lead.repliedAt !== null
      );

      const unchanged =
        lead.score?.composite === result.composite && lead.tier === tier && lead.intent === intent;
      if (unchanged) continue;

      summary.leadsChanged++;
      if (lead.tier !== tier) summary.tierChanges++;
      if (lead.intent !== intent) summary.intentChanges++;

      // One transaction per lead: evidence is replaced wholesale, so a partial
      // write would leave a score whose evidence no longer explains it.
      await db.$transaction(async (tx) => {
        const score = await tx.leadScore.upsert({
          where: { leadId: lead.id },
          create: {
            workspaceId,
            leadId: lead.id,
            fitScore: result.dimensions.fit,
            intentScore: result.dimensions.intent,
            urgencyScore: result.dimensions.urgency,
            authorityScore: result.dimensions.authority,
            budgetScore: result.dimensions.budget,
            reachabilityScore: result.dimensions.reachability,
            engagementScore: result.dimensions.engagement,
            recencyScore: result.dimensions.recency,
            composite: result.composite,
            displayScore: result.displayScore,
            computedAt: now,
          },
          update: {
            fitScore: result.dimensions.fit,
            intentScore: result.dimensions.intent,
            urgencyScore: result.dimensions.urgency,
            authorityScore: result.dimensions.authority,
            budgetScore: result.dimensions.budget,
            reachabilityScore: result.dimensions.reachability,
            engagementScore: result.dimensions.engagement,
            recencyScore: result.dimensions.recency,
            composite: result.composite,
            displayScore: result.displayScore,
            computedAt: now,
          },
        });

        await tx.leadScoreEvidence.deleteMany({ where: { leadScoreId: score.id } });
        if (result.evidence.length > 0) {
          await tx.leadScoreEvidence.createMany({
            data: result.evidence.map((e) => ({
              workspaceId,
              leadScoreId: score.id,
              dimension: e.dimension,
              points: e.points,
              label: e.label,
              detail: e.detail ?? null,
              signalId: e.signalId ?? null,
              sourceType: e.sourceType,
              sourceRef: e.sourceRef ?? null,
            })),
          });
        }

        await tx.lead.update({
          where: { id: lead.id },
          data: { tier, intent },
        });
      });

      summary.evidenceRows += result.evidence.length;
      if (lead.tier !== tier) {
        await emitWebhookEvent(workspaceId, "lead.scored", { leadId: lead.id, fromTier: lead.tier, toTier: tier, scoreOutOf100: result.composite });
      }
    }

    if (opts.leadIds?.length) break;
    if (leads.length < BATCH) break;
  }

  // Account intent rolls up from the leads that were just rescored.
  await rollUpAccountIntent(workspaceId);

  return summary;
}

/** §59 — account intent is derived from scored leads, never asserted directly. */
async function rollUpAccountIntent(workspaceId: string): Promise<void> {
  const rows = await db.lead.findMany({
    where: { workspaceId, deletedAt: null, discardedAt: null },
    select: { companyId: true, score: { select: { composite: true } } },
  });

  const byCompany = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.score) continue;
    const list = byCompany.get(r.companyId) ?? [];
    list.push(r.score.composite);
    byCompany.set(r.companyId, list);
  }

  for (const [companyId, scores] of byCompany) {
    const top = Math.max(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const rolled = Math.round(top * 0.6 + avg * 0.4);

    const lastSignal = await db.signal.findFirst({
      where: { workspaceId, companyId },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });

    await db.company.update({
      where: { id: companyId },
      data: {
        intentScore: rolled,
        lastSignalAt: lastSignal?.occurredAt ?? null,
        intentScoreReason: {
          method: "0.6 × strongest lead + 0.4 × average lead score",
          strongestLeadScore: top,
          averageLeadScore: Math.round(avg),
          leadsConsidered: scores.length,
          note: "Account intent is derived from scored leads at this company, never from the company record alone.",
        },
      },
    });
  }
}
