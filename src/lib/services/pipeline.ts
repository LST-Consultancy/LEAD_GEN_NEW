import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { toPlain } from "@/lib/serialize";
import { recordActivity, recordAudit } from "@/lib/services/audit";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";

const DAY = 86_400_000;

export async function getPipelineBoard(ctx: AuthContext, pipelineId?: string) {
  const pipeline = pipelineId
    ? await db.pipeline.findFirst({
        where: { id: pipelineId, workspaceId: ctx.workspaceId, deletedAt: null },
      })
    : await db.pipeline.findFirst({
        where: { workspaceId: ctx.workspaceId, deletedAt: null },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      });

  if (!pipeline) return null;

  const ownerScope = leadVisibilityFilter(ctx).ownerId
    ? { ownerId: leadVisibilityFilter(ctx).ownerId }
    : {};

  const [stages, deals, pipelines] = await Promise.all([
    db.pipelineStage.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { sortOrder: "asc" },
    }),
    db.deal.findMany({
      where: { workspaceId: ctx.workspaceId, pipelineId: pipeline.id, deletedAt: null, ...ownerScope },
      orderBy: [{ sortOrder: "asc" }, { valueInr: "desc" }],
      include: {
        company: { select: { id: true, name: true, domain: true, logoUrl: true, industry: true, city: true } },
        owner: { select: { id: true, name: true, avatarUrl: true } },
        lead: {
          select: {
            id: true,
            tier: true,
            intent: true,
            person: { select: { fullName: true, avatarUrl: true } },
            score: { select: { displayScore: true } },
          },
        },
        risks: { where: { resolvedAt: null }, orderBy: { severity: "asc" } },
        _count: { select: { tasks: true, proposals: true } },
      },
    }),
    db.pipeline.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, name: true, isDefault: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const columns = stages.map((stage) => {
    const stageDeals = deals.filter((d) => d.stageId === stage.id);
    const totalInr = stageDeals.reduce((s, d) => s + Number(d.valueInr), 0);
    const ages = stageDeals.map((d) => (Date.now() - d.stageEnteredAt.getTime()) / DAY);

    return {
      id: stage.id,
      key: stage.key,
      name: stage.name,
      sortOrder: stage.sortOrder,
      probability: stage.probability,
      isWon: stage.isWon,
      isLost: stage.isLost,
      stallAfterDays: stage.stallAfterDays,
      count: stageDeals.length,
      totalInr,
      weightedInr: Math.round(totalInr * (stage.probability / 100)),
      averageAgeDays: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0,
      deals: stageDeals.map((d) => {
        const ageDays = Math.floor((Date.now() - d.stageEnteredAt.getTime()) / DAY);
        const inactiveDays = d.lastActivityAt
          ? Math.floor((Date.now() - d.lastActivityAt.getTime()) / DAY)
          : null;
        return {
          id: d.id,
          title: d.title,
          valueInr: d.valueInr,
          status: d.status,
          confidence: d.confidence,
          sortOrder: d.sortOrder,
          stageId: d.stageId,
          ageInStageDays: ageDays,
          isStalled: ageDays > stage.stallAfterDays && d.status === "OPEN",
          inactiveDays,
          expectedCloseAt: d.expectedCloseAt,
          nextActionAt: d.nextActionAt,
          nextActionLabel: d.nextActionLabel,
          isNextActionOverdue: d.nextActionAt ? d.nextActionAt < new Date() : false,
          lostReason: d.lostReason,
          company: d.company,
          owner: d.owner,
          lead: d.lead
            ? {
                id: d.lead.id,
                name: d.lead.person.fullName,
                avatarUrl: d.lead.person.avatarUrl,
                tier: d.lead.tier,
                intent: d.lead.intent,
                score: d.lead.score ? Number(d.lead.score.displayScore) : null,
              }
            : null,
          risks: d.risks.map((r) => ({
            code: r.code,
            severity: r.severity,
            title: r.title,
            explanation: r.explanation,
            suggestedAction: r.suggestedAction,
          })),
          counts: { tasks: d._count.tasks, proposals: d._count.proposals },
        };
      }),
    };
  });

  const open = deals.filter((d) => d.status === "OPEN");
  const totals = {
    openCount: open.length,
    openInr: open.reduce((s, d) => s + Number(d.valueInr), 0),
    weightedInr: Math.round(
      open.reduce((s, d) => {
        const stage = stages.find((st) => st.id === d.stageId);
        return s + Number(d.valueInr) * ((stage?.probability ?? 0) / 100);
      }, 0)
    ),
    // High severity only, for the same reason as the Today tiles.
    atRiskInr: open
      .filter((d) => d.risks.some((r) => r.severity === "high"))
      .reduce((s, d) => s + Number(d.valueInr), 0),
    atRiskCount: open.filter((d) => d.risks.some((r) => r.severity === "high")).length,
    watchInr: open
      .filter((d) => d.risks.some((r) => r.severity === "medium"))
      .reduce((s, d) => s + Number(d.valueInr), 0),
    watchCount: open.filter((d) => d.risks.some((r) => r.severity === "medium")).length,
  };

  return toPlain({
    pipeline: { id: pipeline.id, name: pipeline.name },
    pipelines,
    columns,
    totals,
  });
}

export class DealMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealMoveError";
  }
}

/**
 * Moves a deal between stages. Writes stage history, sets won/lost timestamps
 * and records both audit and activity rows in one transaction, so a partial
 * move can never leave the board and the history disagreeing.
 */
export async function moveDeal(
  ctx: AuthContext,
  opts: { dealId: string; toStageId: string; sortOrder?: number; lostReason?: string }
) {
  const deal = await db.deal.findFirst({
    where: { id: opts.dealId, workspaceId: ctx.workspaceId, deletedAt: null },
    include: { stage: true },
  });
  if (!deal) throw new DealMoveError("That deal no longer exists.");

  const toStage = await db.pipelineStage.findFirst({
    where: { id: opts.toStageId, workspaceId: ctx.workspaceId, pipelineId: deal.pipelineId },
  });
  if (!toStage) throw new DealMoveError("That stage is not part of this pipeline.");

  if (toStage.isLost && !opts.lostReason && !deal.lostReason) {
    throw new DealMoveError("A lost reason is required so the loss is learnable.");
  }

  const now = new Date();
  const daysInStage = Math.floor((now.getTime() - deal.stageEnteredAt.getTime()) / DAY);

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.deal.update({
      where: { id: deal.id },
      data: {
        stageId: toStage.id,
        sortOrder: opts.sortOrder ?? 0,
        stageEnteredAt: toStage.id === deal.stageId ? deal.stageEnteredAt : now,
        status: toStage.isWon ? "WON" : toStage.isLost ? "LOST" : "OPEN",
        wonAt: toStage.isWon ? now : null,
        lostAt: toStage.isLost ? now : null,
        lostReason: toStage.isLost ? (opts.lostReason ?? deal.lostReason) : null,
        confidence: toStage.isWon ? 100 : toStage.isLost ? 0 : deal.confidence,
        lastActivityAt: now,
      },
      include: { stage: true, company: { select: { id: true, name: true } } },
    });

    if (toStage.id !== deal.stageId) {
      await tx.dealStageHistory.create({
        data: {
          workspaceId: ctx.workspaceId,
          dealId: deal.id,
          fromStageId: deal.stageId,
          toStageId: toStage.id,
          valueAtMove: deal.valueInr,
          daysInStage,
          actorType: "HUMAN",
          actorUserId: ctx.userId,
        },
      });

      // Stage-entry resolves stage-stall risk; other risks persist until fixed.
      await tx.dealRisk.updateMany({
        where: { dealId: deal.id, code: "stage_stalled", resolvedAt: null },
        data: { resolvedAt: now },
      });
    }

    return next;
  });

  if (toStage.id !== deal.stageId) {
    // Dwell time restarted and the stage probability changed, so the risk view
    // and the worklist ranking are both stale.
    await enqueue(
      JOB.DETECT_DEAL_RISKS,
      { workspaceId: ctx.workspaceId },
      { dedupeKey: `risks-${ctx.workspaceId}`, delayMs: 5_000 }
    );

    await Promise.all([
      recordAudit(ctx, {
        action: "deal.stage_changed",
        objectType: "Deal",
        objectId: deal.id,
        before: { stage: deal.stage.name, status: deal.status },
        after: { stage: toStage.name, status: updated.status },
      }),
      recordActivity(ctx, {
        kind: "deal.stage_changed",
        summary: `${updated.company.name} moved from ${deal.stage.name} to ${toStage.name}`,
        detail: toStage.isLost ? (opts.lostReason ?? null) ?? undefined : undefined,
        dealId: deal.id,
        companyId: updated.companyId,
        leadId: deal.leadId ?? undefined,
        amountInr: Number(deal.valueInr),
      }),
    ]);
  }

  return toPlain({
    id: updated.id,
    stageId: updated.stageId,
    stageName: updated.stage.name,
    status: updated.status,
  });
}

/** §74 — algorithmic estimate shown alongside the rep's own call, not instead. */
export async function getForecast(ctx: AuthContext) {
  const ownerScope = leadVisibilityFilter(ctx).ownerId
    ? { ownerId: leadVisibilityFilter(ctx).ownerId }
    : {};

  const open = await db.deal.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "OPEN", ...ownerScope },
    select: {
      valueInr: true,
      confidence: true,
      repForecast: true,
      stage: { select: { probability: true } },
      risks: { where: { resolvedAt: null }, select: { severity: true } },
    },
  });

  const algorithmic = Math.round(
    open.reduce((s, d) => s + Number(d.valueInr) * (d.stage.probability / 100), 0)
  );
  const repCommit = open
    .filter((d) => d.repForecast === "commit")
    .reduce((s, d) => s + Number(d.valueInr), 0);
  const repBestCase = open
    .filter((d) => d.repForecast === "commit" || d.repForecast === "best_case")
    .reduce((s, d) => s + Number(d.valueInr), 0);
  const atRisk = open
    .filter((d) => d.risks.some((r) => r.severity === "high"))
    .reduce((s, d) => s + Number(d.valueInr), 0);

  return {
    pipelineInr: open.reduce((s, d) => s + Number(d.valueInr), 0),
    algorithmicInr: algorithmic,
    repCommitInr: repCommit,
    repBestCaseInr: repBestCase,
    atRiskInr: atRisk,
    dealCount: open.length,
    // Stated openly rather than presented as precision.
    uncertaintyNote:
      "The algorithmic figure weights each deal by its stage probability. It is an estimate from historical stage behaviour, not a prediction about these specific deals.",
  };
}
