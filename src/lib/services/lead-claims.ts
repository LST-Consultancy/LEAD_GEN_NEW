import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError } from "./mutate";

/**
 * The claim queue: leads nobody owns, offered to anyone who can work leads. It does not widen what
 * a rep can see elsewhere — the queue shows only what is needed to decide (company, title, tier,
 * intent, why it surfaced), never contact details, and claiming is what makes the lead theirs.
 */
export async function listClaimable(ctx: AuthContext, limit = 25) {
  assertPermission(ctx, PERMISSIONS.LEADS_EDIT);
  const rows = await db.lead.findMany({
    where: { workspaceId: ctx.workspaceId, ownerId: null, deletedAt: null, archivedAt: null },
    orderBy: [{ tier: "asc" }, { createdAt: "desc" }], take: Math.min(100, Math.max(1, limit)),
    select: { id: true, tier: true, intent: true, surfacedReason: true, createdAt: true, company: { select: { name: true, industry: true, city: true } }, person: { select: { fullName: true, employments: { where: { isCurrent: true }, select: { title: true }, take: 1 } } } },
  });
  const total = await db.lead.count({ where: { workspaceId: ctx.workspaceId, ownerId: null, deletedAt: null, archivedAt: null } });
  return toPlain({ total, leads: rows.map(r => ({ id: r.id, tier: r.tier, intent: r.intent, surfacedReason: r.surfacedReason, createdAt: r.createdAt, company: r.company, name: r.person.fullName, title: r.person.employments[0]?.title ?? null })) });
}

/** Takes an unowned lead. Atomic: if someone claimed it a moment earlier, this says so and changes nothing. */
export async function claimLead(ctx: AuthContext, leadId: string) {
  z.string().uuid().parse(leadId);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const { count } = await db.lead.updateMany({ where: { id: leadId, workspaceId: ctx.workspaceId, ownerId: null, deletedAt: null }, data: { ownerId: ctx.userId } });
    if (!count) {
      const exists = await db.lead.findFirst({ where: { id: leadId, workspaceId: ctx.workspaceId, deletedAt: null }, select: { ownerId: true } });
      throw new MutationError(exists ? "Someone claimed this lead a moment ago." : "That lead was not found.", exists ? "already_claimed" : "not_found", exists ? 409 : 404);
    }
    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { companyId: true, person: { select: { fullName: true } } } });
    return { result: { leadId, ownerId: ctx.userId }, log: { action: "lead.claimed", objectType: "Lead", objectId: leadId, before: { ownerId: null }, after: { ownerId: ctx.userId }, activity: { kind: "lead.claimed", summary: `${ctx.user.name} claimed ${lead.person.fullName}`, leadId, companyId: lead.companyId } } };
  });
}
