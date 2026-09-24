import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import type { Permission } from "@/lib/auth/permissions";
import { recordAudit, recordActivity } from "@/lib/services/audit";

/**
 * Shared scaffolding for every write in the app.
 *
 * Each mutation must do the same four things in the same order: check the
 * caller's permission, confirm the row is inside their tenant, apply the
 * change, then record it in both the audit log and the activity stream. Doing
 * that by hand at 30 call sites is how one of them ends up missing a tenant
 * check, so it lives here instead.
 */

export class MutationError extends Error {
  constructor(
    message: string,
    public readonly code: string = "mutation_failed",
    public readonly status: number = 409
  ) {
    super(message);
    this.name = "MutationError";
  }
}

export function notFoundError(what = "That record"): MutationError {
  return new MutationError(
    `${what} doesn't exist, or you don't have access to it.`,
    "not_found",
    404
  );
}

/**
 * Loads a tenant-owned row or throws a 404. A row in another workspace and a
 * row that was deleted are deliberately indistinguishable from outside.
 */
export async function loadScoped<T>(
  loader: () => Promise<T | null>,
  what: string
): Promise<T> {
  const row = await loader();
  if (!row) throw notFoundError(what);
  return row;
}

type LogSpec = {
  action: string;
  objectType: string;
  objectId: string;
  before?: unknown;
  after?: unknown;
  /** Omit to skip the user-visible activity row (e.g. for trivial toggles). */
  activity?: {
    kind: string;
    summary: string;
    detail?: string;
    leadId?: string;
    companyId?: string;
    dealId?: string;
    amountInr?: number;
    channel?: "EMAIL" | "WHATSAPP" | "LINKEDIN" | "PHONE" | "SMS" | "IN_PERSON";
    metadata?: Record<string, unknown>;
  };
};

/**
 * Runs a write with its permission gate and both log writes. The audit entry is
 * always recorded; the activity row only when the change is worth surfacing in
 * the team feed.
 */
export async function mutate<T>(
  ctx: AuthContext,
  permission: Permission,
  work: () => Promise<{ result: T; log: LogSpec }>
): Promise<T> {
  assertPermission(ctx, permission);

  const { result, log } = await work();

  await recordAudit(ctx, {
    action: log.action,
    objectType: log.objectType,
    objectId: log.objectId,
    before: log.before,
    after: log.after,
  });

  if (log.activity) {
    await recordActivity(ctx, log.activity);
  }

  return result;
}

/**
 * Soft-deletes a row and indexes it for the recycle bin, so "restore" and the
 * visible purge date both have something to read (§82).
 */
export async function softDelete(
  ctx: AuthContext,
  opts: { objectType: string; objectId: string; label: string; retentionDays?: number }
): Promise<void> {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { recycleBinDays: true },
  });
  const days = opts.retentionDays ?? workspace.recycleBinDays;

  await db.deletedRecord.upsert({
    where: {
      workspaceId_objectType_objectId: {
        workspaceId: ctx.workspaceId,
        objectType: opts.objectType,
        objectId: opts.objectId,
      },
    },
    create: {
      workspaceId: ctx.workspaceId,
      objectType: opts.objectType,
      objectId: opts.objectId,
      label: opts.label,
      deletedByUserId: ctx.userId,
      deletedByLabel: ctx.user.name,
      purgeAfter: new Date(Date.now() + days * 86_400_000),
    },
    update: {
      restoredAt: null,
      deletedByUserId: ctx.userId,
      deletedByLabel: ctx.user.name,
      purgeAfter: new Date(Date.now() + days * 86_400_000),
    },
  });
}

/** Clears a recycle-bin entry when the row is restored. */
export async function clearDeletedRecord(
  ctx: AuthContext,
  objectType: string,
  objectId: string
): Promise<void> {
  await db.deletedRecord.updateMany({
    where: { workspaceId: ctx.workspaceId, objectType, objectId },
    data: { restoredAt: new Date() },
  });
}

/**
 * Refreshes a lead's denormalised activity timestamp. Called after anything
 * that counts as touching the lead, so the Leads table's "last activity"
 * column and the dormancy filters stay truthful.
 */
export async function touchLead(leadId: string, at: Date = new Date()): Promise<void> {
  await db.lead.update({ where: { id: leadId }, data: { lastActivityAt: at } });
}
