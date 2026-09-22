import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";

type AuditSource = "UI" | "API" | "MCP" | "AUTOPILOT" | "INTEGRATION" | "SYSTEM";

/**
 * §83 — every state change gets a row with before/after and the actor's origin.
 * Audit writes must never break the operation they describe, so failures are
 * logged and swallowed rather than thrown.
 */
export async function recordAudit(
  ctx: Pick<AuthContext, "workspaceId" | "userId" | "user" | "sessionId">,
  entry: {
    action: string;
    objectType: string;
    objectId?: string;
    before?: unknown;
    after?: unknown;
    source?: AuditSource;
    actorType?: "HUMAN" | "AI" | "SYSTEM";
    actorLabel?: string;
    ipAddress?: string;
  }
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        actorType: entry.actorType ?? "HUMAN",
        actorUserId: entry.actorType === "HUMAN" || !entry.actorType ? ctx.userId : null,
        actorLabel: entry.actorLabel ?? ctx.user.name,
        source: entry.source ?? "UI",
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        before: entry.before === undefined ? undefined : (entry.before as never),
        after: entry.after === undefined ? undefined : (entry.after as never),
        ipAddress: entry.ipAddress,
        sessionId: ctx.sessionId,
      },
    });
  } catch (err) {
    console.error("[audit] failed to record entry", entry.action, err);
  }
}

/**
 * An audit entry for a write made by someone outside the workspace — today,
 * only a person holding a proposal link.
 *
 * Separate from `recordAudit` because there is no user, no session and no
 * verified identity, and the entry has to say so rather than borrowing a
 * team member's name. `claimedBy` is what they typed; the row records it as
 * claimed, and `identityVerified: false` goes in the payload.
 */
export async function recordExternalAudit(
  workspaceId: string,
  entry: {
    action: string;
    objectType: string;
    objectId?: string;
    before?: unknown;
    after?: unknown;
    claimedBy: string;
    via: string;
    ipAddress?: string;
  }
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        workspaceId,
        actorType: "SYSTEM",
        actorUserId: null,
        actorLabel: `${entry.claimedBy} (claimed, via ${entry.via})`,
        source: "INTEGRATION",
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        before: entry.before === undefined ? undefined : (entry.before as never),
        after: entry.after === undefined ? undefined : (entry.after as never),
        ipAddress: entry.ipAddress,
        sessionId: null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to record external entry", entry.action, err);
  }
}

/** Mirrors an audit entry into the user-visible activity stream (§118). */
export async function recordActivity(
  // `userId` may be null: an activity row can come from a system actor or from
  // someone outside the workspace acting on a proposal link.
  ctx: { workspaceId: string; userId: string | null },
  entry: {
    kind: string;
    summary: string;
    detail?: string;
    actorType?: "HUMAN" | "AI" | "SYSTEM";
    leadId?: string;
    companyId?: string;
    dealId?: string;
    channel?: "EMAIL" | "WHATSAPP" | "LINKEDIN" | "PHONE" | "SMS" | "IN_PERSON";
    amountInr?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await db.activity.create({
      data: {
        workspaceId: ctx.workspaceId,
        kind: entry.kind,
        summary: entry.summary,
        detail: entry.detail,
        actorType: entry.actorType ?? "HUMAN",
        actorUserId: entry.actorType === "AI" || entry.actorType === "SYSTEM" ? null : ctx.userId,
        leadId: entry.leadId,
        companyId: entry.companyId,
        dealId: entry.dealId,
        channel: entry.channel,
        amountInr: entry.amountInr,
        metadata: (entry.metadata ?? {}) as never,
      },
    });
  } catch (err) {
    console.error("[activity] failed to record", entry.kind, err);
  }
}
