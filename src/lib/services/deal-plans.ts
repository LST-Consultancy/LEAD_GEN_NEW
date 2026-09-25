import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { dealVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { STANDARD_PLAN, STEP_STATUS, hasCycle, waitingOn } from "@/lib/plans/template";
import { randomBytes } from "node:crypto";
import { toPaise, toRupees } from "@/lib/proposals/money";
import { MutationError, loadScoped, mutate, softDelete } from "./mutate";

/**
 * Deal plans: who does what, in what order, across sales, delivery and cash.
 *
 * Rules enforced here, not in the screen:
 * - a step cannot start or finish while a step it depends on is unfinished;
 * - a client gate cannot be completed without a recorded client approval, and
 *   the approver's name is recorded as the team typed it — not verified;
 * - owners must be members; everything follows the deal's visibility.
 */

async function scopedDeal(ctx: AuthContext, dealId: string) {
  return loadScoped(() => db.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId, deletedAt: null, ...dealVisibilityFilter(ctx) }, select: { id: true, title: true, status: true, leadId: true, companyId: true, ownerId: true } }), "That deal");
}

type TemplateStepRow = { key: string; phase: string; title: string; completionCriteria: string | null; dependsOn: string[]; isClientGate: boolean };
const templateStepSchema = z.object({ key: z.string(), phase: z.enum(["sales", "delivery", "cash"]), title: z.string(), completionCriteria: z.string().nullable(), dependsOn: z.array(z.string()), isClientGate: z.boolean() });

/** The steps a plan starts from: the standard template, or one of the workspace's own. */
async function templateSteps(ctx: AuthContext, templateId?: string): Promise<{ key: string; version: number; label: string; steps: TemplateStepRow[] }> {
  if (!templateId) {
    return {
      key: STANDARD_PLAN.key, version: STANDARD_PLAN.version, label: "standard",
      steps: STANDARD_PLAN.steps.map((s) => ({ key: s.key, phase: s.phase, title: s.title, completionCriteria: s.completionCriteria, dependsOn: [...s.dependsOn], isClientGate: "isClientGate" in s ? Boolean(s.isClientGate) : false })),
    };
  }
  const t = await loadScoped(() => db.planTemplate.findFirst({ where: { id: templateId, workspaceId: ctx.workspaceId, deletedAt: null } }), "That template");
  const steps = z.array(templateStepSchema).safeParse(t.steps);
  if (!steps.success || steps.data.length === 0) throw new MutationError("That template's steps can't be read. Save it again from a plan.", "bad_template", 422);
  return { key: t.id, version: t.version, label: `${t.name} v${t.version}`, steps: steps.data };
}

export async function startDealPlan(ctx: AuthContext, dealId: string, templateId?: string) {
  const deal = await scopedDeal(ctx, dealId);
  const existing = await db.dealPlan.findUnique({ where: { dealId }, select: { id: true } });
  if (existing) return { planId: existing.id, created: false };
  const template = await templateSteps(ctx, templateId);
  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const plan = await db.dealPlan.create({
      data: {
        workspaceId: ctx.workspaceId, dealId, templateKey: template.key, templateVersion: template.version, createdById: ctx.userId,
        steps: { create: template.steps.map((s, i) => ({ workspaceId: ctx.workspaceId, key: s.key, order: i + 1, phase: s.phase, title: s.title, completionCriteria: s.completionCriteria, dependsOn: s.dependsOn, isClientGate: s.isClientGate, ownerId: deal.ownerId })) },
      },
    });
    return {
      result: { planId: plan.id, created: true },
      log: { action: "deal.plan_started", objectType: "Deal", objectId: dealId, after: { template: template.label, steps: template.steps.length }, activity: { kind: "deal.plan_started", summary: `Plan started for ${deal.title} (${template.label})`, dealId, leadId: deal.leadId ?? undefined, companyId: deal.companyId } },
    };
  });
}

/** Saves this deal's current steps as a workspace template. Same name → next version. */
export async function savePlanAsTemplate(ctx: AuthContext, dealId: string, rawName: string) {
  const name = z.string().trim().min(3, "Give the template a name of at least three characters.").max(80).parse(rawName);
  await scopedDeal(ctx, dealId);
  const plan = await loadScoped(() => db.dealPlan.findFirst({ where: { dealId, workspaceId: ctx.workspaceId }, include: { steps: { orderBy: { order: "asc" } } } }), "That plan");
  // Skipped steps are what this deal did not need; they are not part of the method.
  const steps = plan.steps.filter((x) => x.status !== "skipped");
  const kept = new Set(steps.map((x) => x.key));
  const snapshot: TemplateStepRow[] = steps.map((x) => ({ key: x.key, phase: x.phase, title: x.title, completionCriteria: x.completionCriteria, dependsOn: x.dependsOn.filter((d) => kept.has(d)), isClientGate: x.isClientGate }));
  const latest = await db.planTemplate.findFirst({ where: { workspaceId: ctx.workspaceId, name: { equals: name, mode: "insensitive" } }, orderBy: { version: "desc" }, select: { version: true, name: true } });
  return mutate(ctx, PERMISSIONS.PIPELINE_CONFIGURE, async () => {
    const t = await db.planTemplate.create({ data: { workspaceId: ctx.workspaceId, name: latest?.name ?? name, version: (latest?.version ?? 0) + 1, steps: snapshot as never, createdById: ctx.userId } });
    return { result: { id: t.id, name: t.name, version: t.version, steps: snapshot.length }, log: { action: "plan_template.saved", objectType: "PlanTemplate", objectId: t.id, after: { name: t.name, version: t.version, steps: snapshot.length } } };
  });
}

/** Latest version of each template name, plus the standard one. */
export async function listPlanTemplates(ctx: AuthContext) {
  const rows = await db.planTemplate.findMany({ where: { workspaceId: ctx.workspaceId, deletedAt: null }, orderBy: [{ name: "asc" }, { version: "desc" }], select: { id: true, name: true, version: true, steps: true, createdAt: true } });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.name.toLowerCase())) latest.set(r.name.toLowerCase(), r);
  return [...latest.values()].map((r) => ({ id: r.id, name: r.name, version: r.version, steps: Array.isArray(r.steps) ? r.steps.length : 0, createdAt: r.createdAt.toISOString() }));
}

export async function deletePlanTemplate(ctx: AuthContext, id: string) {
  const t = await loadScoped(() => db.planTemplate.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }), "That template");
  return mutate(ctx, PERMISSIONS.PIPELINE_CONFIGURE, async () => {
    // Every version of the name goes; plans already started keep their steps.
    await db.planTemplate.updateMany({ where: { workspaceId: ctx.workspaceId, name: t.name, deletedAt: null }, data: { deletedAt: new Date() } });
    await softDelete(ctx, { objectType: "PlanTemplate", objectId: id, label: t.name });
    return { result: { id }, log: { action: "plan_template.deleted", objectType: "PlanTemplate", objectId: id, before: { name: t.name } } };
  });
}

export async function getDealPlan(ctx: AuthContext, dealId: string) {
  const deal = await db.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId, deletedAt: null, ...dealVisibilityFilter(ctx) }, select: { id: true, title: true, status: true, valueInr: true, company: { select: { id: true, name: true } } } });
  if (!deal) return null;
  const plan = await db.dealPlan.findUnique({ where: { dealId }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!plan) return { deal: toPlain(deal), plan: null };
  const owners = await db.user.findMany({ where: { id: { in: plan.steps.map((s) => s.ownerId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  // What the deal's money record says, shown beside the cash steps. It informs
  // the step; it does not tick it — "invoice raised" is a person's call.
  const money = await db.moneyEntry.findMany({ where: { dealId, workspaceId: ctx.workspaceId }, select: { kind: true, amountInr: true } });
  const sum = (kinds: string[]) => toRupees(money.filter((m) => kinds.includes(m.kind)).reduce((n, m) => n + toPaise(Number(m.amountInr)), 0));
  const moneySummary = { invoicedInr: sum(["invoice", "adjustment"]), paidInr: sum(["payment"]), entries: money.length };
  return {
    money: moneySummary,
    deal: toPlain(deal),
    plan: {
      id: plan.id, template: plan.templateKey === STANDARD_PLAN.key ? `standard v${plan.templateVersion}` : `${(await db.planTemplate.findFirst({ where: { id: plan.templateKey }, select: { name: true } }))?.name ?? "saved template"} v${plan.templateVersion}`,
      steps: plan.steps.map((s) => ({
        id: s.id, key: s.key, order: s.order, phase: s.phase, title: s.title, completionCriteria: s.completionCriteria, dependsOn: s.dependsOn,
        isClientGate: s.isClientGate, status: s.status, requiredSkill: s.requiredSkill, owner: owners.find((o) => o.id === s.ownerId) ?? null, artifact: s.artifact, note: s.note,
        clientApprovedBy: s.clientApprovedBy, clientApprovedAt: s.clientApprovedAt?.toISOString() ?? null, completedAt: s.completedAt?.toISOString() ?? null,
        waitingOn: waitingOn(s, plan.steps).map((k) => plan.steps.find((x) => x.key === k)!.title),
      })),
    },
  };
}

const stepUpdate = z.object({
  status: z.enum(STEP_STATUS).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  artifact: z.string().trim().max(500).optional(),
  note: z.string().trim().max(2000).optional(),
  clientApprovedBy: z.string().trim().min(2).max(120).optional(),
  title: z.string().trim().min(2).max(160).optional(),
  completionCriteria: z.string().trim().max(500).optional(),
  dependsOn: z.array(z.string().max(60)).max(20).optional(),
  requiredSkill: z.string().trim().max(40).nullable().optional(),
});

export async function updatePlanStep(ctx: AuthContext, stepId: string, raw: z.input<typeof stepUpdate>) {
  const input = stepUpdate.parse(raw);
  const step = await loadScoped(() => db.dealPlanStep.findFirst({ where: { id: stepId, workspaceId: ctx.workspaceId, plan: { deal: { deletedAt: null, ...dealVisibilityFilter(ctx) } } }, include: { plan: { include: { steps: true, deal: { select: { id: true, title: true, leadId: true, companyId: true } } } } } }), "That step");
  const deal = step.plan.deal;

  if (input.ownerId) {
    const m = await db.workspaceMember.findFirst({ where: { workspaceId: ctx.workspaceId, userId: input.ownerId, deletedAt: null }, select: { id: true } });
    if (!m) throw new MutationError("That person is not a member of this workspace.", "not_a_member", 422);
  }
  if (input.status === "in_progress" || input.status === "done") {
    const blocking = waitingOn(step, step.plan.steps);
    if (blocking.length) {
      const names = blocking.map((k) => step.plan.steps.find((s) => s.key === k)!.title);
      throw new MutationError(`Finish ${names.join(" and ")} first — this step depends on ${names.length === 1 ? "it" : "them"}.`, "dependency_open", 409);
    }
  }
  if (input.dependsOn) {
    const keys = new Set(step.plan.steps.map((x) => x.key));
    const unknown = input.dependsOn.filter((k) => !keys.has(k));
    if (unknown.length) throw new MutationError("A step can only depend on steps in this plan.", "unknown_dependency", 422);
    if (input.dependsOn.includes(step.key)) throw new MutationError("A step cannot depend on itself.", "self_dependency", 422);
    const next = step.plan.steps.map((x) => (x.id === step.id ? { key: x.key, dependsOn: input.dependsOn! } : { key: x.key, dependsOn: x.dependsOn }));
    if (hasCycle(next)) throw new MutationError("That would make steps wait on each other in a loop, so none could ever start.", "dependency_cycle", 422);
  }
  const approver = input.clientApprovedBy ?? step.clientApprovedBy;
  if (input.status === "done" && step.isClientGate && !approver) {
    throw new MutationError("This is a client approval step. Record who at the client approved it before marking it done.", "approval_required", 422);
  }

  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const now = new Date();
    const updated = await db.dealPlanStep.update({
      where: { id: stepId },
      data: {
        ...(input.status ? { status: input.status, ...(input.status === "done" ? { completedAt: now, completedById: ctx.userId } : { completedAt: null, completedById: null }) } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.artifact !== undefined ? { artifact: input.artifact || null } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
        ...(input.clientApprovedBy ? { clientApprovedBy: input.clientApprovedBy, clientApprovedAt: now } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.completionCriteria !== undefined ? { completionCriteria: input.completionCriteria || null } : {}),
        ...(input.dependsOn ? { dependsOn: input.dependsOn } : {}),
        ...(input.requiredSkill !== undefined ? { requiredSkill: input.requiredSkill ? input.requiredSkill.toLowerCase() : null } : {}),
      },
    });
    const done = input.status === "done" && step.status !== "done";
    return {
      result: { id: stepId, status: updated.status },
      log: {
        action: "deal.plan_step_updated", objectType: "DealPlanStep", objectId: stepId,
        before: { status: step.status, ownerId: step.ownerId, title: step.title, dependsOn: step.dependsOn }, after: { status: updated.status, ownerId: updated.ownerId, clientApprovedBy: updated.clientApprovedBy, title: updated.title, dependsOn: updated.dependsOn },
        activity: done ? { kind: "deal.plan_step_done", summary: `${step.title} done on ${deal.title}${step.isClientGate ? ` — approved by ${updated.clientApprovedBy} (as recorded by the team)` : ""}`, dealId: deal.id, leadId: deal.leadId ?? undefined, companyId: deal.companyId } : undefined,
      },
    };
  });
}

/** Plans across the deals this person can see, with progress and what is next. */
export async function listDealPlans(ctx: AuthContext) {
  const plans = await db.dealPlan.findMany({
    where: { workspaceId: ctx.workspaceId, deal: { deletedAt: null, ...dealVisibilityFilter(ctx) } },
    include: { deal: { select: { id: true, title: true, status: true, company: { select: { name: true } } } }, steps: { orderBy: { order: "asc" } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return plans.map((p) => {
    const next = p.steps.find((s) => s.status !== "done" && s.status !== "skipped" && waitingOn(s, p.steps).length === 0);
    return {
      dealId: p.deal.id, dealTitle: p.deal.title, company: p.deal.company.name, dealStatus: p.deal.status,
      done: p.steps.filter((s) => s.status === "done" || s.status === "skipped").length, total: p.steps.length,
      blocked: p.steps.filter((s) => s.status === "blocked").length,
      next: next ? { title: next.title, phase: next.phase } : null,
    };
  });
}

/** Open and won deals, visible to this person, that have no plan yet. */
export async function dealsWithoutPlan(ctx: AuthContext, limit = 20) {
  const rows = await db.deal.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, status: { in: ["OPEN", "WON"] }, plan: null, ...dealVisibilityFilter(ctx) },
    orderBy: [{ status: "desc" }, { valueInr: "desc" }],
    take: limit,
    select: { id: true, title: true, status: true, company: { select: { name: true } } },
  });
  return rows.map((d) => ({ id: d.id, title: d.title, status: d.status, company: d.company.name }));
}

const addSchema = z.object({
  phase: z.enum(["sales", "delivery", "cash"]),
  title: z.string().trim().min(2).max(160),
  completionCriteria: z.string().trim().max(500).optional(),
  dependsOn: z.array(z.string().max(60)).max(20).default([]),
  isClientGate: z.boolean().default(false),
});

/** Adds a step to the end of a phase. Its key is new, so nothing already depends on it. */
export async function addPlanStep(ctx: AuthContext, dealId: string, raw: z.input<typeof addSchema>) {
  const input = addSchema.parse(raw);
  const deal = await scopedDeal(ctx, dealId);
  const plan = await loadScoped(() => db.dealPlan.findFirst({ where: { dealId, workspaceId: ctx.workspaceId }, include: { steps: true } }), "That plan");
  const keys = new Set(plan.steps.map((x) => x.key));
  if (input.dependsOn.some((k) => !keys.has(k))) throw new MutationError("A step can only depend on steps in this plan.", "unknown_dependency", 422);
  if (plan.steps.length >= 40) throw new MutationError("A plan holds up to 40 steps.", "too_many_steps", 422);
  const key = `custom-${randomBytes(3).toString("hex")}`;
  const lastInPhase = Math.max(0, ...plan.steps.filter((x) => x.phase === input.phase).map((x) => x.order));
  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const created = await db.$transaction(async (tx) => {
      // Make room after the phase's last step so the plan keeps reading in order.
      await tx.dealPlanStep.updateMany({ where: { planId: plan.id, order: { gt: lastInPhase } }, data: { order: { increment: 1 } } });
      return tx.dealPlanStep.create({ data: { workspaceId: ctx.workspaceId, planId: plan.id, key, order: lastInPhase + 1, phase: input.phase, title: input.title, completionCriteria: input.completionCriteria ?? null, dependsOn: input.dependsOn, isClientGate: input.isClientGate, ownerId: deal.ownerId } });
    });
    return { result: { id: created.id, key }, log: { action: "deal.plan_step_added", objectType: "DealPlan", objectId: plan.id, after: { title: input.title, phase: input.phase, dependsOn: input.dependsOn } } };
  });
}

/** Swaps a step with its neighbour in the same phase. Order is for reading; dependencies still decide what can start. */
export async function movePlanStep(ctx: AuthContext, stepId: string, direction: "up" | "down") {
  const step = await loadScoped(() => db.dealPlanStep.findFirst({ where: { id: stepId, workspaceId: ctx.workspaceId, plan: { deal: { deletedAt: null, ...dealVisibilityFilter(ctx) } } }, include: { plan: { include: { steps: true } } } }), "That step");
  const phase = step.plan.steps.filter((x) => x.phase === step.phase).sort((a, b) => a.order - b.order);
  const i = phase.findIndex((x) => x.id === step.id);
  const other = phase[direction === "up" ? i - 1 : i + 1];
  if (!other) return { moved: false };
  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    await db.$transaction([
      db.dealPlanStep.update({ where: { id: step.id }, data: { order: -1 } }),
      db.dealPlanStep.update({ where: { id: other.id }, data: { order: step.order } }),
      db.dealPlanStep.update({ where: { id: step.id }, data: { order: other.order } }),
    ]);
    return { result: { moved: true }, log: { action: "deal.plan_step_moved", objectType: "DealPlanStep", objectId: step.id, before: { order: step.order }, after: { order: other.order } } };
  });
}
