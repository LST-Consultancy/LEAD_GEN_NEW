import "server-only";
import { z } from "zod";
import { patchSchemaOf } from "@/lib/schema/patch";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate, softDelete } from "@/lib/services/mutate";
import { TOOLS } from "@/lib/ai/tools";
import {
  healthOf,
  resolveSteps,
  type PlaybookHealth,
  type ResolvedStep,
} from "@/lib/playbooks/steps";

/**
 * §65 — playbooks.
 *
 * A playbook is a trigger plus an ordered list of steps. Nothing here executes
 * one: the execution path is the agent runner, and wiring a half-built runner
 * to a screen with a Run button is precisely the thing not to ship. So every
 * playbook is returned with its steps resolved against the tool registry and a
 * sentence saying what would stop it.
 */

const stepSchema = z.object({
  order: z.number().int().min(1),
  action: z.string().trim().min(1).max(60),
  note: z.string().trim().max(400).optional(),
});

const triggerSchema = z
  .object({
    industries: z.array(z.string().trim()).max(20).optional(),
    employeeMin: z.number().int().min(0).optional(),
    employeeMax: z.number().int().min(0).optional(),
    keywords: z.array(z.string().trim().toLowerCase()).max(20).optional(),
    signalTypes: z.array(z.string().trim()).max(20).optional(),
    delayDays: z.number().int().min(0).max(365).optional(),
  })
  .strict();

const playbookSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional(),
  trigger: triggerSchema.default({}),
  steps: z.array(stepSchema).max(20).default([]),
  isActive: z.boolean().default(false),
  isAgentTriggerable: z.boolean().default(false),
});

export type PlaybookInput = z.input<typeof playbookSchema>;

export type PlaybookSummary = {
  id: string;
  name: string;
  description: string | null;
  trigger: Record<string, unknown>;
  steps: ResolvedStep[];
  health: PlaybookHealth;
  isActive: boolean;
  isAgentTriggerable: boolean;
  timesRun: number;
  updatedAt: string;
};

const toolStates = () => TOOLS.map((t) => ({ name: t.name, implemented: t.implemented }));

function summarise(row: {
  id: string;
  name: string;
  description: string | null;
  triggerJson: unknown;
  steps: unknown;
  isActive: boolean;
  isAgentTriggerable: boolean;
  timesRun: number;
  updatedAt: Date;
}): PlaybookSummary {
  // Parsed tolerantly: a hand-edited or half-migrated step list should cost
  // that one step, not the whole playbook.
  const raw = Array.isArray(row.steps) ? row.steps : [];
  const steps = raw
    .map((s) => stepSchema.safeParse(s))
    .filter((r): r is { success: true; data: z.infer<typeof stepSchema> } => r.success)
    .map((r) => r.data);

  const resolved = resolveSteps(steps, toolStates());
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trigger: (row.triggerJson ?? {}) as Record<string, unknown>,
    steps: resolved,
    health: healthOf(resolved),
    isActive: row.isActive,
    isAgentTriggerable: row.isAgentTriggerable,
    timesRun: row.timesRun,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPlaybooks(ctx: AuthContext): Promise<PlaybookSummary[]> {
  const rows = await db.playbook.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
  });
  return rows.map(summarise);
}

export async function createPlaybook(ctx: AuthContext, raw: PlaybookInput) {
  const input = playbookSchema.parse(raw);
  assertActivatable(input);

  return mutate(ctx, PERMISSIONS.AGENTS_CONFIGURE, async () => {
    const row = await db.playbook.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        description: input.description ?? null,
        triggerJson: input.trigger,
        steps: input.steps,
        isActive: input.isActive,
        isAgentTriggerable: input.isAgentTriggerable,
      },
    });
    return {
      result: toPlain(summarise(row)),
      log: {
        action: "playbook.created",
        objectType: "Playbook",
        objectId: row.id,
        after: { name: row.name, steps: input.steps.length, isActive: row.isActive },
        activity: { kind: "playbook.created", summary: `Playbook created: ${row.name}` },
      },
    };
  });
}

export async function updatePlaybook(ctx: AuthContext, id: string, raw: Partial<PlaybookInput>) {
  // `patchSchemaOf`, not `.partial()` — the latter kept `steps`' default, so
  // any partial update wrote an empty step list over the real one.
  const input = patchSchemaOf(playbookSchema).parse(raw) as Partial<z.infer<typeof playbookSchema>>;
  const existing = await loadScoped(
    () => db.playbook.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That playbook"
  );

  // Activation is checked against the steps that will be stored, not the ones
  // already there — otherwise activating while clearing the steps slips past.
  const current = summarise(existing);
  assertActivatable({
    isActive: input.isActive ?? existing.isActive,
    steps:
      input.steps ??
      current.steps.map((s) => ({ order: s.order, action: s.action, note: s.note })),
  });

  return mutate(ctx, PERMISSIONS.AGENTS_CONFIGURE, async () => {
    const row = await db.playbook.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.trigger !== undefined ? { triggerJson: input.trigger } : {}),
        ...(input.steps !== undefined ? { steps: input.steps } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isAgentTriggerable !== undefined
          ? { isAgentTriggerable: input.isAgentTriggerable }
          : {}),
      },
    });
    return {
      result: toPlain(summarise(row)),
      log: {
        action: "playbook.updated",
        objectType: "Playbook",
        objectId: id,
        before: { name: existing.name, isActive: existing.isActive },
        after: { name: row.name, isActive: row.isActive },
        activity:
          existing.isActive !== row.isActive
            ? {
                kind: "playbook.updated",
                summary: `Playbook ${row.isActive ? "activated" : "deactivated"}: ${row.name}`,
              }
            : undefined,
      },
    };
  });
}

export async function deletePlaybook(ctx: AuthContext, id: string) {
  const existing = await loadScoped(
    () => db.playbook.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That playbook"
  );

  return mutate(ctx, PERMISSIONS.AGENTS_CONFIGURE, async () => {
    await db.playbook.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await softDelete(ctx, { objectType: "Playbook", objectId: id, label: existing.name });
    return {
      result: { id },
      log: {
        action: "playbook.deleted",
        objectType: "Playbook",
        objectId: id,
        before: { name: existing.name },
        activity: { kind: "playbook.deleted", summary: `Playbook removed: ${existing.name}` },
      },
    };
  });
}

/**
 * Refuses to mark a playbook active when not one of its steps could act.
 *
 * The alternative is an Active badge over a playbook that does nothing, which
 * is worse than refusing — the person believes automation is running.
 */
function assertActivatable(input: {
  isActive?: boolean;
  steps?: { order: number; action: string; note?: string }[];
}) {
  if (!input.isActive) return;
  const health = healthOf(resolveSteps(input.steps ?? [], toolStates()));
  if (health.inert) {
    throw new MutationError(
      `This playbook can't be activated yet. ${health.blockedBecause} It stays saved as a draft.`,
      "playbook_inert",
      422
    );
  }
}
