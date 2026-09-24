import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate, softDelete, touchLead } from "@/lib/services/mutate";

const LANES = ["QUEUED", "IN_PROGRESS", "NEEDS_ATTENTION", "DONE"] as const;

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  ownerId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  channel: z.enum(["EMAIL", "WHATSAPP", "LINKEDIN", "PHONE", "SMS", "IN_PERSON"]).optional(),
  dueAt: z.coerce.date().optional(),
  collaboratorIds: z.array(z.string().uuid()).max(20).optional(),
});

/**
 * Priority score for a hand-made task.
 *
 * Agent-created tasks get a score from the ranking model with a written reason.
 * A task a person typed has no such evidence, so it is scored from what is
 * actually known — its priority, deadline and the value it touches — rather
 * than being given a fake model score.
 */
function manualPriorityScore(
  priority: string,
  dueAt: Date | undefined,
  impactInr: number | null
): { score: number; reason: string } {
  const base = { URGENT: 70, HIGH: 55, MEDIUM: 40, LOW: 20 }[priority] ?? 40;
  let score = base;
  const reasons = [`Set to ${priority.toLowerCase()} priority when created`];

  if (dueAt) {
    const days = (dueAt.getTime() - Date.now()) / 86_400_000;
    if (days < 0) {
      score += 20;
      reasons.push("already overdue");
    } else if (days <= 1) {
      score += 14;
      reasons.push("due within a day");
    } else if (days <= 3) {
      score += 7;
      reasons.push("due within three days");
    }
  }
  if (impactInr && impactInr > 0) {
    score += impactInr >= 5_000_000 ? 10 : impactInr >= 1_000_000 ? 6 : 3;
    reasons.push("attached to an open deal");
  }

  return {
    score: Math.min(100, score),
    reason: `${reasons.join(", ")}. Created by hand, so this rank comes from the deadline and deal value rather than a model.`,
  };
}

/** An owner must be a current member of this workspace; a bare user id could belong to anyone. */
async function assertMember(ctx: AuthContext, userId: string) {
  const member = await db.workspaceMember.findFirst({ where: { workspaceId: ctx.workspaceId, userId, deletedAt: null }, select: { id: true } });
  if (!member) throw new MutationError("That person is not a member of this workspace.", "not_a_member", 422);
}

export async function createTask(
  ctx: AuthContext,
  raw: z.input<typeof createTaskSchema>
) {
  const input = createTaskSchema.parse(raw);
  if (input.leadId) {
    await loadScoped(
      () =>
        db.lead.findFirst({
          where: {
            id: input.leadId,
            workspaceId: ctx.workspaceId,
            deletedAt: null,
            ...leadVisibilityFilter(ctx),
          },
        }),
      "That lead"
    );
  }

  if (input.companyId) {
    await loadScoped(() => db.company.findFirst({ where: { id: input.companyId, workspaceId: ctx.workspaceId, deletedAt: null }, select: { id: true } }), "That company");
  }
  if (input.ownerId) await assertMember(ctx, input.ownerId);

  let impactInr: number | null = null;
  if (input.dealId) {
    const deal = await loadScoped(
      () =>
        db.deal.findFirst({
          where: { id: input.dealId, workspaceId: ctx.workspaceId, deletedAt: null },
          select: { valueInr: true },
        }),
      "That deal"
    );
    impactInr = Number(deal.valueInr);
  }

  const { score, reason } = manualPriorityScore(input.priority, input.dueAt, impactInr);

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const task = await db.task.create({
      data: {
        workspaceId: ctx.workspaceId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        ownerId: input.ownerId ?? ctx.userId,
        leadId: input.leadId ?? null,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
        channel: input.channel ?? null,
        dueAt: input.dueAt ?? null,
        priorityScore: score,
        priorityReason: reason,
        expectedImpactInr: impactInr,
        revenueImpact: impactInr ? "direct" : "hygiene",
        createdByAi: false,
        lane: "QUEUED",
        status: "QUEUED",
      },
      include: { owner: { select: { id: true, name: true, avatarUrl: true } } },
    });

    if (input.collaboratorIds?.length) {
      const members = await db.workspaceMember.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          userId: { in: input.collaboratorIds },
          deletedAt: null,
        },
        select: { userId: true },
      });
      await db.taskAssignment.createMany({
        data: members.map((m) => ({
          workspaceId: ctx.workspaceId,
          taskId: task.id,
          userId: m.userId,
        })),
        skipDuplicates: true,
      });
    }

    if (input.leadId) await touchLead(input.leadId);

    return {
      result: toPlain({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        priorityScore: task.priorityScore,
        priorityReason: task.priorityReason,
        dueAt: task.dueAt,
        owner: task.owner,
        lane: task.lane,
      }),
      log: {
        action: "task.created",
        objectType: "Task",
        objectId: task.id,
        after: { title: task.title, priority: task.priority, dueAt: task.dueAt },
        activity: {
          kind: "task.created",
          summary: `Task created: ${task.title}`,
          leadId: input.leadId,
          companyId: input.companyId,
          dealId: input.dealId,
        },
      },
    };
  });
}

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["QUEUED", "WORKING", "NEEDS_ATTENTION", "DONE", "CANCELLED"]).optional(),
  lane: z.enum(LANES).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  ownerId: z.string().uuid().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  snoozedUntil: z.coerce.date().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

async function scopedTask(ctx: AuthContext, taskId: string) {
  return loadScoped(
    () =>
      db.task.findFirst({
        where: { id: taskId, workspaceId: ctx.workspaceId, deletedAt: null },
        include: {
          lead: { select: { id: true, personId: true, person: { select: { fullName: true } } } },
        },
      }),
    "That task"
  );
}

export async function updateTask(
  ctx: AuthContext,
  taskId: string,
  raw: z.infer<typeof updateTaskSchema>
) {
  const input = updateTaskSchema.parse(raw);
  const task = await scopedTask(ctx, taskId);

  // A rep may work their own queue but not silently reassign someone else's.
  const isOwn = task.ownerId === ctx.userId;
  const canManageOthers = ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL);
  if (!isOwn && !canManageOthers) {
    throw new MutationError("That task belongs to someone else.", "forbidden", 403);
  }
  if (input.ownerId && input.ownerId !== task.ownerId) await assertMember(ctx, input.ownerId);

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const completing = input.status === "DONE" && task.status !== "DONE";
    const reopening = task.status === "DONE" && input.status && input.status !== "DONE";

    const updated = await db.task.update({
      where: { id: taskId },
      data: {
        ...input,
        // Keep status and lane consistent: they are two views of one state.
        ...(input.status === "DONE" ? { lane: "DONE" } : {}),
        ...(input.lane === "DONE" && !input.status ? { status: "DONE" } : {}),
        ...(input.lane === "IN_PROGRESS" && !input.status ? { status: "WORKING" } : {}),
        ...(input.lane === "NEEDS_ATTENTION" && !input.status
          ? { status: "NEEDS_ATTENTION" }
          : {}),
        ...(completing ? { completedAt: new Date() } : {}),
        ...(reopening ? { completedAt: null } : {}),
      },
      include: { owner: { select: { id: true, name: true, avatarUrl: true } } },
    });

    if (task.leadId) await touchLead(task.leadId);

    return {
      result: toPlain({
        id: updated.id,
        title: updated.title,
        status: updated.status,
        lane: updated.lane,
        priority: updated.priority,
        dueAt: updated.dueAt,
        snoozedUntil: updated.snoozedUntil,
        completedAt: updated.completedAt,
        owner: updated.owner,
      }),
      log: {
        action: completing ? "task.completed" : "task.updated",
        objectType: "Task",
        objectId: taskId,
        before: { status: task.status, lane: task.lane, ownerId: task.ownerId },
        after: { status: updated.status, lane: updated.lane, ownerId: updated.ownerId },
        activity: input.ownerId && input.ownerId !== task.ownerId
          ? { kind: "task.reassigned", summary: `Reassigned: ${updated.title} → ${updated.owner?.name ?? "someone"}`, leadId: task.leadId ?? undefined, companyId: task.companyId ?? undefined, dealId: task.dealId ?? undefined }
          : completing
          ? {
              kind: "task.completed",
              summary: `Completed: ${updated.title}`,
              leadId: task.leadId ?? undefined,
              companyId: task.companyId ?? undefined,
              dealId: task.dealId ?? undefined,
            }
          : undefined,
      },
    };
  });
}

export async function deleteTask(ctx: AuthContext, taskId: string) {
  const task = await scopedTask(ctx, taskId);

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    await db.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
    await softDelete(ctx, { objectType: "Task", objectId: taskId, label: task.title });
    return {
      result: { id: taskId, deleted: true },
      log: {
        action: "task.deleted",
        objectType: "Task",
        objectId: taskId,
        before: { title: task.title, status: task.status },
      },
    };
  });
}
