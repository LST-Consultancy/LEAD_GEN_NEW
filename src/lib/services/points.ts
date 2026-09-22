import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";

export const POINT_COSTS = {
  REVEAL_CONTACT: 1,
  DEEP_RESEARCH: 2,
  VOICE_NOTE: 1,
  BULK_ENRICH_PER_LEAD: 1,
} as const;

export class InsufficientPointsError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number
  ) {
    super(`Needs ${required} points, ${available} available`);
    this.name = "InsufficientPointsError";
  }
}

export async function getBalance(workspaceId: string): Promise<number> {
  const head = await db.pointLedger.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });
  return head?.balanceAfter ?? 0;
}

/**
 * Appends to the immutable ledger inside a transaction.
 *
 * Re-reading the head row is not enough on its own: because every write is an
 * INSERT rather than an UPDATE of a shared row, two concurrent spends under
 * PostgreSQL's default READ COMMITTED isolation both read the same balance and
 * both succeed, overdrawing the account and corrupting the running total. So
 * the transaction first takes a row lock on the workspace, which serialises
 * every point movement for that tenant.
 *
 * `idempotencyKey` makes a retried request safe — the unique index rejects the
 * duplicate and the original row is returned.
 */
export async function spendPoints(
  ctx: AuthContext,
  opts: {
    type: "REVEAL" | "RESEARCH" | "ENRICHMENT" | "VOICE_NOTE";
    amount: number;
    reason: string;
    refType?: string;
    refId?: string;
    idempotencyKey: string;
    actorType?: "HUMAN" | "AI";
  }
) {
  const existing = await db.pointLedger.findUnique({
    where: { idempotencyKey: opts.idempotencyKey },
  });
  if (existing) return existing;

  return db.$transaction(async (tx) => {
    // Serialises concurrent spends for this workspace. Other tenants are
    // unaffected because the lock is scoped to a single Workspace row.
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${ctx.workspaceId}::uuid FOR UPDATE`;

    const head = await tx.pointLedger.findFirst({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      select: { balanceAfter: true },
    });
    const available = head?.balanceAfter ?? 0;
    if (available < opts.amount) {
      throw new InsufficientPointsError(opts.amount, available);
    }

    return tx.pointLedger.create({
      data: {
        workspaceId: ctx.workspaceId,
        type: opts.type,
        delta: -opts.amount,
        balanceAfter: available - opts.amount,
        reason: opts.reason,
        actorType: opts.actorType ?? "HUMAN",
        actorUserId: ctx.userId,
        refType: opts.refType,
        refId: opts.refId,
        idempotencyKey: opts.idempotencyKey,
      },
    });
  });
}

/** Used when a paid operation fails and the user must not be charged (§127). */
export async function refundPoints(
  ctx: AuthContext,
  opts: { amount: number; reason: string; refType?: string; refId?: string; idempotencyKey: string }
) {
  const existing = await db.pointLedger.findUnique({
    where: { idempotencyKey: opts.idempotencyKey },
  });
  if (existing) return existing;

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${ctx.workspaceId}::uuid FOR UPDATE`;

    const head = await tx.pointLedger.findFirst({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      select: { balanceAfter: true },
    });
    const available = head?.balanceAfter ?? 0;
    return tx.pointLedger.create({
      data: {
        workspaceId: ctx.workspaceId,
        type: "REFUND",
        delta: opts.amount,
        balanceAfter: available + opts.amount,
        reason: opts.reason,
        actorType: "SYSTEM",
        refType: opts.refType,
        refId: opts.refId,
        idempotencyKey: opts.idempotencyKey,
      },
    });
  });
}

/** Burn-rate projection for the billing screen (§79). */
export async function getUsageProjection(workspaceId: string) {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const spends = await db.pointLedger.findMany({
    where: { workspaceId, delta: { lt: 0 }, createdAt: { gte: since } },
    select: { delta: true, createdAt: true },
  });

  const spent = spends.reduce((sum, s) => sum + Math.abs(s.delta), 0);
  const perDay = spent / 14;
  const balance = await getBalance(workspaceId);

  return {
    balance,
    spentLast14Days: spent,
    averagePerDay: Math.round(perDay * 10) / 10,
    daysRemaining: perDay > 0 ? Math.floor(balance / perDay) : null,
  };
}
