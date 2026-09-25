import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { dealVisibilityFilter, type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError, loadScoped } from "./mutate";
import { planAssignments, type RouteMember } from "@/lib/teamcollab/routing";

/** Each member's skills, capacity and current load of open plan steps, from the rows. */
export async function teamLoad(ctx: AuthContext): Promise<RouteMember[]> {
  const [members, open] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspaceId: ctx.workspaceId, deletedAt: null }, include: { user: { select: { name: true } } } }),
    db.dealPlanStep.groupBy({ by: ["ownerId"], where: { workspaceId: ctx.workspaceId, status: { not: "done" }, ownerId: { not: null }, plan: { deal: { deletedAt: null } } }, _count: { _all: true } }),
  ]);
  return members.map(m => ({ userId: m.userId, name: m.user.name, skills: m.skills, stepCapacity: m.stepCapacity, isAway: m.isAway, openSteps: open.find(o => o.ownerId === m.userId)?._count._all ?? 0 }));
}

const skillsSchema = z.object({ skills: z.array(z.string().trim().min(1).max(40)).max(20), stepCapacity: z.number().int().min(1).max(200).nullable(), isAway: z.boolean() });
export async function setMemberRouting(ctx: AuthContext, memberId: string, raw: unknown) {
  const input = skillsSchema.parse(raw ?? {});
  const m = await loadScoped(() => db.workspaceMember.findFirst({ where: { id: memberId, workspaceId: ctx.workspaceId, deletedAt: null }, include: { user: { select: { name: true } } } }), "That member");
  return mutate(ctx, PERMISSIONS.USERS_MANAGE, async () => {
    const skills = [...new Set(input.skills.map(s => s.toLowerCase()))];
    const updated = await db.workspaceMember.update({ where: { id: m.id }, data: { skills, stepCapacity: input.stepCapacity, isAway: input.isAway } });
    return { result: toPlain({ id: updated.id, skills: updated.skills, stepCapacity: updated.stepCapacity, isAway: updated.isAway }), log: { action: "member.routing_updated", objectType: "WorkspaceMember", objectId: m.id, before: { skills: m.skills, stepCapacity: m.stepCapacity, isAway: m.isAway }, after: { skills, stepCapacity: input.stepCapacity, isAway: input.isAway } } };
  });
}

/**
 * Assigns a plan's unowned open steps by skill and capacity. Steps nobody can take are left
 * unassigned with the reason. Owned steps are never reassigned: moving work off someone is a
 * person's decision.
 */
export async function autoAssignPlan(ctx: AuthContext, dealId: string, opts: { dryRun?: boolean } = {}) {
  const plan = await loadScoped(() => db.dealPlan.findFirst({ where: { workspaceId: ctx.workspaceId, dealId, deal: { deletedAt: null, ...dealVisibilityFilter(ctx) } }, include: { steps: { where: { ownerId: null, status: { not: "done" } }, orderBy: { order: "asc" } }, deal: { select: { id: true, title: true } } } }), "That plan");
  if (!plan.steps.length) throw new MutationError("Every open step in this plan already has an owner.", "nothing_to_assign", 409);
  const plans = planAssignments(plan.steps.map(s => ({ id: s.id, title: s.title, requiredSkill: s.requiredSkill })), await teamLoad(ctx));
  if (opts.dryRun) return toPlain({ assignments: plans, applied: false });
  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    for (const a of plans) if (a.ownerId) await db.dealPlanStep.updateMany({ where: { id: a.stepId, ownerId: null }, data: { ownerId: a.ownerId } });
    const n = plans.filter(a => a.ownerId).length;
    return { result: toPlain({ assignments: plans, applied: true }), log: { action: "deal.plan_auto_assigned", objectType: "DealPlan", objectId: plan.id, after: { assignments: plans.map(a => ({ stepId: a.stepId, ownerId: a.ownerId, reason: a.reason })) }, activity: n ? { kind: "deal.plan_assigned", summary: `${n} ${n === 1 ? "step" : "steps"} on ${plan.deal.title} assigned by skill and capacity`, dealId: plan.deal.id } : undefined } };
  });
}
