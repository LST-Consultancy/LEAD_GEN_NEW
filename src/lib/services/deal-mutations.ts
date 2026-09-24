import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { dealVisibilityFilter, leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate, softDelete, touchLead } from "@/lib/services/mutate";
import { formatInrCompact } from "@/lib/format";

async function scopedDeal(ctx: AuthContext, dealId: string) {
  return loadScoped(
    () =>
      db.deal.findFirst({
        where: { id: dealId, workspaceId: ctx.workspaceId, deletedAt: null, ...dealVisibilityFilter(ctx) },
        include: {
          company: { select: { id: true, name: true } },
          stage: { select: { id: true, name: true, probability: true } },
        },
      }),
    "That deal"
  );
}

export const createDealSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  leadId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  valueInr: z.number().min(0).max(100_000_000_000),
  expectedCloseAt: z.coerce.date().optional(),
  ownerId: z.string().uuid().optional(),
  nextActionLabel: z.string().trim().max(200).optional(),
  nextActionAt: z.coerce.date().optional(),
});

/**
 * Promotes a lead into a tracked opportunity. Either a lead or a company must
 * be given; a lead supplies the company automatically.
 */
export async function createDeal(
  ctx: AuthContext,
  raw: z.input<typeof createDealSchema>
) {
  const input = createDealSchema.parse(raw);

  if (!input.leadId && !input.companyId) {
    throw new MutationError(
      "A deal needs either a lead or a company to belong to.",
      "invalid_request",
      400
    );
  }

  let companyId = input.companyId;
  let leadName: string | null = null;

  if (input.leadId) {
    const lead = await loadScoped(
      () =>
        db.lead.findFirst({
          where: {
            id: input.leadId,
            workspaceId: ctx.workspaceId,
            deletedAt: null,
            ...leadVisibilityFilter(ctx),
          },
          include: {
            person: { select: { fullName: true } },
            company: { select: { id: true, name: true } },
          },
        }),
      "That lead"
    );
    companyId = lead.companyId;
    leadName = lead.person.fullName;

    const existing = await db.deal.findFirst({
      where: { workspaceId: ctx.workspaceId, leadId: input.leadId, deletedAt: null, status: "OPEN" },
    });
    if (existing) {
      throw new MutationError(
        "That lead already has an open deal. Update it rather than creating a second one.",
        "duplicate_deal",
        409
      );
    }
  }

  const company = await loadScoped(
    () =>
      db.company.findFirst({
        where: { id: companyId, workspaceId: ctx.workspaceId, deletedAt: null },
      }),
    "That company"
  );

  const pipeline = await loadScoped(
    () =>
      input.pipelineId
        ? db.pipeline.findFirst({
            where: { id: input.pipelineId, workspaceId: ctx.workspaceId, deletedAt: null },
          })
        : db.pipeline.findFirst({
            where: { workspaceId: ctx.workspaceId, deletedAt: null },
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          }),
    "A pipeline"
  );

  const stage = await loadScoped(
    () =>
      input.stageId
        ? db.pipelineStage.findFirst({
            where: { id: input.stageId, pipelineId: pipeline.id },
          })
        : db.pipelineStage.findFirst({
            where: { pipelineId: pipeline.id },
            orderBy: { sortOrder: "asc" },
          }),
    "A pipeline stage"
  );

  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const now = new Date();
    const deal = await db.deal.create({
      data: {
        workspaceId: ctx.workspaceId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        leadId: input.leadId ?? null,
        companyId: company.id,
        ownerId: input.ownerId ?? ctx.userId,
        title: input.title ?? `${company.name} — new opportunity`,
        valueInr: input.valueInr,
        status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
        confidence: stage.probability,
        expectedCloseAt: input.expectedCloseAt ?? null,
        nextActionLabel: input.nextActionLabel ?? null,
        nextActionAt: input.nextActionAt ?? null,
        stageEnteredAt: now,
        lastActivityAt: now,
        source: input.leadId ? "Promoted from lead" : "Created manually",
      },
      include: {
        stage: { select: { id: true, name: true, key: true, probability: true } },
        owner: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // The opening history row has no origin stage, which marks it as "entered
    // the pipeline" rather than a move — see netMovement in services/today.
    await db.dealStageHistory.create({
      data: {
        workspaceId: ctx.workspaceId,
        dealId: deal.id,
        fromStageId: null,
        toStageId: stage.id,
        valueAtMove: input.valueInr,
        daysInStage: 0,
        actorType: "HUMAN",
        actorUserId: ctx.userId,
      },
    });

    if (input.leadId) {
      await db.lead.update({
        where: { id: input.leadId },
        data: { status: "QUALIFIED", lastActivityAt: now },
      });
    }

    return {
      result: toPlain({
        id: deal.id,
        title: deal.title,
        valueInr: deal.valueInr,
        status: deal.status,
        stage: deal.stage,
        owner: deal.owner,
      }),
      log: {
        action: "deal.created",
        objectType: "Deal",
        objectId: deal.id,
        after: { title: deal.title, valueInr: Number(deal.valueInr), stage: stage.name },
        activity: {
          kind: "deal.created",
          summary: `Deal created: ${deal.title} · ${formatInrCompact(Number(deal.valueInr))}${leadName ? ` (from ${leadName})` : ""}`,
          leadId: input.leadId,
          companyId: company.id,
          dealId: deal.id,
          amountInr: Number(deal.valueInr),
        },
      },
    };
  });
}

export const updateDealSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  valueInr: z.number().min(0).max(100_000_000_000).optional(),
  ownerId: z.string().uuid().optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  repForecast: z.enum(["pipeline", "best_case", "commit"]).nullable().optional(),
  expectedCloseAt: z.coerce.date().nullable().optional(),
  nextActionLabel: z.string().trim().max(200).nullable().optional(),
  nextActionAt: z.coerce.date().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function updateDeal(
  ctx: AuthContext,
  dealId: string,
  raw: z.infer<typeof updateDealSchema>
) {
  const input = updateDealSchema.parse(raw);
  const deal = await scopedDeal(ctx, dealId);
  if (input.ownerId && input.ownerId !== deal.ownerId) {
    if (input.ownerId !== ctx.userId && !ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL)) {
      throw new MutationError("Handing a deal to someone else needs permission to see the whole team's pipeline. Ask a manager.", "forbidden", 403);
    }
    const member = await db.workspaceMember.findFirst({ where: { workspaceId: ctx.workspaceId, userId: input.ownerId, deletedAt: null }, select: { id: true } });
    if (!member) throw new MutationError("That person is not a member of this workspace.", "not_a_member", 422);
  }

  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const before = {
      title: deal.title,
      valueInr: Number(deal.valueInr),
      ownerId: deal.ownerId,
      confidence: deal.confidence,
      repForecast: deal.repForecast,
      nextActionLabel: deal.nextActionLabel,
      expectedCloseAt: deal.expectedCloseAt?.toISOString() ?? null,
    };

    const updated = await db.deal.update({
      where: { id: dealId },
      data: { ...input, lastActivityAt: new Date() },
      include: {
        stage: { select: { id: true, name: true, key: true, probability: true } },
        owner: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Setting a next action resolves the risk flag that complained about its
    // absence; the flag should not outlive the problem.
    if (input.nextActionAt || input.nextActionLabel) {
      await db.dealRisk.updateMany({
        where: { dealId, code: "no_next_action", resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
    }
    // A close date moved into the future answers the "close date passed" flag.
    if (input.expectedCloseAt && input.expectedCloseAt.getTime() > Date.now()) {
      await db.dealRisk.updateMany({
        where: { dealId, code: "close_date_passed", resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
    }
    if (deal.leadId) await touchLead(deal.leadId);

    const after = {
      title: updated.title,
      valueInr: Number(updated.valueInr),
      ownerId: updated.ownerId,
      confidence: updated.confidence,
      repForecast: updated.repForecast,
      nextActionLabel: updated.nextActionLabel,
      expectedCloseAt: updated.expectedCloseAt?.toISOString() ?? null,
    };

    const valueChanged = before.valueInr !== after.valueInr;

    return {
      result: toPlain({
        id: updated.id,
        title: updated.title,
        valueInr: updated.valueInr,
        confidence: updated.confidence,
        repForecast: updated.repForecast,
        expectedCloseAt: updated.expectedCloseAt,
        nextActionLabel: updated.nextActionLabel,
        nextActionAt: updated.nextActionAt,
        stage: updated.stage,
        owner: updated.owner,
      }),
      log: {
        action: "deal.updated",
        objectType: "Deal",
        objectId: dealId,
        before,
        after,
        activity: valueChanged
          ? {
              kind: "deal.value_changed",
              summary: `${deal.company.name} deal value ${formatInrCompact(before.valueInr)} → ${formatInrCompact(after.valueInr)}`,
              dealId,
              companyId: deal.companyId,
              leadId: deal.leadId ?? undefined,
              amountInr: after.valueInr,
            }
          : undefined,
      },
    };
  });
}

export async function deleteDeal(ctx: AuthContext, dealId: string) {
  const deal = await scopedDeal(ctx, dealId);

  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    await db.deal.update({ where: { id: dealId }, data: { deletedAt: new Date() } });
    await softDelete(ctx, {
      objectType: "Deal",
      objectId: dealId,
      label: `${deal.title} · ${formatInrCompact(Number(deal.valueInr))}`,
    });
    return {
      result: { id: dealId, deleted: true },
      log: {
        action: "deal.deleted",
        objectType: "Deal",
        objectId: dealId,
        before: { title: deal.title, valueInr: Number(deal.valueInr) },
        activity: {
          kind: "deal.deleted",
          summary: `Deal removed: ${deal.title}`,
          companyId: deal.companyId,
          dealId,
        },
      },
    };
  });
}

/** Resolves a risk flag once the underlying problem is actually addressed. */
export async function resolveDealRisk(ctx: AuthContext, dealId: string, code: string) {
  await scopedDeal(ctx, dealId);

  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const result = await db.dealRisk.updateMany({
      where: { dealId, code, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    if (result.count === 0) {
      throw new MutationError("That flag is already resolved.", "already_resolved", 409);
    }
    return {
      result: { dealId, code, resolved: true },
      log: {
        action: "deal.risk_resolved",
        objectType: "DealRisk",
        objectId: dealId,
        after: { code },
      },
    };
  });
}
