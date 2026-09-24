import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { hashPassword, passwordProblems } from "@/lib/auth/password";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate } from "./mutate";
import { recordExternalAudit } from "./audit";

/**
 * Invitations, role changes and member removal.
 *
 * - Nobody can grant more than they hold: a role is assignable only if every
 *   permission in it is one the actor already has. Without that, an admin
 *   could invite an "owner" and act through them.
 * - A workspace always keeps someone who can manage it. "Owner" here means a
 *   role that includes `workspace.manage`, which no role below owner has.
 * - Only the token's hash is stored. The link is returned once, to the person
 *   who created or resent it, and is the whole authorisation for accepting.
 * - Access follows the membership row, which the auth context re-reads on every
 *   request — so a role change or removal takes effect on the next click, for
 *   sessions and API keys alike.
 */

const INVITE_DAYS_DEFAULT = 7;
const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");
const isOwnerRole = (permissions: string[]) => permissions.includes(PERMISSIONS.WORKSPACE_MANAGE);
/** Addresses are compared without case: "Asha@X.com" and "asha@x.com" are one person. */
const sameEmail = (email: string) => ({ equals: email, mode: "insensitive" as const });
const findUserByEmail = (email: string) => db.user.findFirst({ where: { email: sameEmail(email) } });

function assertCanGrant(ctx: AuthContext, rolePermissions: string[]) {
  const beyond = rolePermissions.filter((p) => !ctx.permissions.includes(p));
  if (beyond.length) {
    throw new MutationError(`That role includes permissions you don't have (${beyond.join(", ")}), so you can't give it to someone else.`, "role_exceeds_yours", 403);
  }
}

async function scopedRole(ctx: AuthContext, roleId: string) {
  return loadScoped(() => db.role.findFirst({ where: { id: roleId, workspaceId: ctx.workspaceId } }), "That role");
}

/** Owners remaining if `excludingMemberId` stopped being one. */
async function ownersOtherThan(workspaceId: string, excludingMemberId: string) {
  return db.workspaceMember.count({
    where: { workspaceId, deletedAt: null, id: { not: excludingMemberId }, role: { permissions: { has: PERMISSIONS.WORKSPACE_MANAGE } } },
  });
}

export function invitationLink(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}/invite/${token}`;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listInvitations(ctx: AuthContext) {
  assertPermission(ctx, PERMISSIONS.USERS_MANAGE);
  const rows = await db.invitation.findMany({
    where: { workspaceId: ctx.workspaceId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    include: { role: { select: { id: true, name: true } } },
  });
  const now = Date.now();
  return toPlain(rows.map((r) => ({
    id: r.id, email: r.email, role: r.role, createdAt: r.createdAt, expiresAt: r.expiresAt,
    state: r.expiresAt.getTime() <= now ? ("expired" as const) : ("pending" as const),
  })));
}

/** Roles this person may hand out, for the invite and change-role pickers. */
export async function assignableRoles(ctx: AuthContext) {
  const roles = await db.role.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, permissions: true } });
  return roles.filter((r) => r.permissions.every((p) => ctx.permissions.includes(p))).map(({ id, name }) => ({ id, name }));
}

// ---------------------------------------------------------------------------
// Inviting
// ---------------------------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("That isn't an email address."),
  roleId: z.string().uuid(),
  expiresInDays: z.number().int().min(1).max(30).default(INVITE_DAYS_DEFAULT),
});

export async function createInvitation(ctx: AuthContext, raw: z.input<typeof inviteSchema>) {
  const input = inviteSchema.parse(raw);
  assertPermission(ctx, PERMISSIONS.USERS_MANAGE);
  const role = await scopedRole(ctx, input.roleId);
  assertCanGrant(ctx, role.permissions);

  const member = await db.workspaceMember.findFirst({ where: { workspaceId: ctx.workspaceId, deletedAt: null, user: { email: sameEmail(input.email) } }, select: { id: true } });
  if (member) throw new MutationError(`${input.email} is already a member of this workspace.`, "already_member", 409);
  const pending = await db.invitation.findFirst({ where: { workspaceId: ctx.workspaceId, email: sameEmail(input.email), acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
  if (pending) throw new MutationError(`${input.email} already has a pending invitation. Resend it instead, which makes a fresh link.`, "already_invited", 409);

  const token = randomBytes(32).toString("base64url");
  return mutate(ctx, PERMISSIONS.USERS_MANAGE, async () => {
    const inv = await db.invitation.create({
      data: { workspaceId: ctx.workspaceId, email: input.email, roleId: role.id, tokenHash: hashToken(token), invitedById: ctx.userId, expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000) },
    });
    return {
      result: { id: inv.id, email: inv.email, role: role.name, expiresAt: inv.expiresAt.toISOString(), token },
      log: { action: "invitation.created", objectType: "Invitation", objectId: inv.id, after: { email: inv.email, role: role.name, expiresAt: inv.expiresAt.toISOString() } },
    };
  });
}

/** A fresh token and expiry; the old link stops working. */
export async function resendInvitation(ctx: AuthContext, id: string) {
  assertPermission(ctx, PERMISSIONS.USERS_MANAGE);
  const inv = await loadScoped(() => db.invitation.findFirst({ where: { id, workspaceId: ctx.workspaceId, acceptedAt: null, revokedAt: null }, include: { role: true } }), "That invitation");
  assertCanGrant(ctx, inv.role.permissions);
  const token = randomBytes(32).toString("base64url");
  return mutate(ctx, PERMISSIONS.USERS_MANAGE, async () => {
    const updated = await db.invitation.update({ where: { id }, data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS_DEFAULT * 86_400_000) } });
    return {
      result: { id, email: updated.email, role: inv.role.name, expiresAt: updated.expiresAt.toISOString(), token },
      log: { action: "invitation.resent", objectType: "Invitation", objectId: id, before: { expiresAt: inv.expiresAt.toISOString() }, after: { expiresAt: updated.expiresAt.toISOString() } },
    };
  });
}

export async function revokeInvitation(ctx: AuthContext, id: string) {
  assertPermission(ctx, PERMISSIONS.USERS_MANAGE);
  const inv = await loadScoped(() => db.invitation.findFirst({ where: { id, workspaceId: ctx.workspaceId, acceptedAt: null, revokedAt: null } }), "That invitation");
  return mutate(ctx, PERMISSIONS.USERS_MANAGE, async () => {
    await db.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    return { result: { id }, log: { action: "invitation.revoked", objectType: "Invitation", objectId: id, before: { email: inv.email } } };
  });
}

// ---------------------------------------------------------------------------
// Accepting (public: the token is the authorisation)
// ---------------------------------------------------------------------------

export type InvitationPreview =
  | { state: "valid"; email: string; workspaceName: string; roleName: string; hasAccount: boolean }
  | { state: "expired" | "revoked" | "accepted" | "invalid" };

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { state: "invalid" };
  const inv = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { workspace: { select: { name: true, deletedAt: true } }, role: { select: { name: true } } } });
  if (!inv || inv.workspace.deletedAt) return { state: "invalid" };
  if (inv.acceptedAt) return { state: "accepted" };
  if (inv.revokedAt) return { state: "revoked" };
  if (inv.expiresAt.getTime() <= Date.now()) return { state: "expired" };
  const user = await findUserByEmail(inv.email);
  return { state: "valid", email: inv.email, workspaceName: inv.workspace.name, roleName: inv.role.name, hasAccount: Boolean(user && !user.deletedAt) };
}

const acceptSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), password: z.string().max(200).optional() });

const REFUSED: Record<Exclude<InvitationPreview["state"], "valid">, string> = {
  invalid: "That invitation link isn't valid. Ask for a new one.",
  expired: "That invitation has expired. Ask whoever invited you to resend it.",
  revoked: "That invitation was withdrawn. Ask whoever invited you if you still need access.",
  accepted: "That invitation has already been used. Sign in instead.",
};

/**
 * Accepts once. `signedInUserId` is whoever is signed in on this browser, if
 * anyone. An invitation for an existing account can only be accepted by that
 * account, signed in; one for a new address creates the account here.
 */
export async function acceptInvitation(token: string, raw: z.input<typeof acceptSchema>, signedInUserId: string | null, meta: { ipAddress?: string } = {}) {
  const input = acceptSchema.parse(raw);
  const preview = await previewInvitation(token);
  if (preview.state !== "valid") throw new MutationError(REFUSED[preview.state], `invitation_${preview.state}`, 410);

  const existing = await findUserByEmail(preview.email);
  if (existing && !existing.deletedAt) {
    if (signedInUserId !== existing.id) throw new MutationError(`Sign in as ${preview.email} to accept this invitation.`, "sign_in_required", 401);
  } else {
    if (!input.name) throw new MutationError("Tell us your name.", "name_required", 422);
    const problems = passwordProblems(input.password ?? "");
    if (problems.length) throw new MutationError(problems[0], "weak_password", 422);
  }
  const passwordHash = existing && !existing.deletedAt ? null : await hashPassword(input.password!);

  const outcome = await db.$transaction(async (tx) => {
    // The claim is conditional, so two clicks on the same link accept once.
    const claimed = await tx.invitation.updateMany({ where: { tokenHash: hashToken(token), acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
    if (claimed.count === 0) throw new MutationError(REFUSED.accepted, "invitation_accepted", 410);
    const inv = await tx.invitation.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    const user = existing && !existing.deletedAt
      ? existing
      : await tx.user.upsert({ where: { email: inv.email }, create: { email: inv.email, name: input.name!, passwordHash }, update: { name: input.name!, passwordHash, deletedAt: null } });
    const prior = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } } });
    const member = prior
      ? await tx.workspaceMember.update({ where: { id: prior.id }, data: { roleId: inv.roleId, deletedAt: null, invitedAt: inv.createdAt, joinedAt: new Date() } })
      : await tx.workspaceMember.create({ data: { workspaceId: inv.workspaceId, userId: user.id, roleId: inv.roleId, invitedAt: inv.createdAt } });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedBy: user.id } });
    return { userId: user.id, workspaceId: inv.workspaceId, memberId: member.id, invitationId: inv.id, email: inv.email };
  });

  await recordExternalAudit(outcome.workspaceId, { action: "invitation.accepted", objectType: "Invitation", objectId: outcome.invitationId, after: { memberId: outcome.memberId, email: outcome.email }, claimedBy: outcome.email, via: "invitation link", ipAddress: meta.ipAddress });
  return outcome;
}

// ---------------------------------------------------------------------------
// Changing and removing members
// ---------------------------------------------------------------------------

async function scopedMember(ctx: AuthContext, memberId: string) {
  return loadScoped(() => db.workspaceMember.findFirst({ where: { id: memberId, workspaceId: ctx.workspaceId, deletedAt: null }, include: { role: true, user: { select: { name: true, email: true } } } }), "That member");
}

export async function changeMemberRole(ctx: AuthContext, memberId: string, raw: { roleId: string }) {
  const { roleId } = z.object({ roleId: z.string().uuid() }).parse(raw);
  assertPermission(ctx, PERMISSIONS.USERS_MANAGE);
  const member = await scopedMember(ctx, memberId);
  const role = await scopedRole(ctx, roleId);
  assertCanGrant(ctx, role.permissions);
  // Moving someone *off* a role you couldn't grant is taking power you don't hold.
  assertCanGrant(ctx, member.role.permissions);
  if (isOwnerRole(member.role.permissions) && !isOwnerRole(role.permissions) && (await ownersOtherThan(ctx.workspaceId, memberId)) === 0) {
    throw new MutationError("This is the workspace's only owner. Make someone else an owner first.", "last_owner", 409);
  }
  return mutate(ctx, PERMISSIONS.USERS_MANAGE, async () => {
    await db.workspaceMember.update({ where: { id: memberId }, data: { roleId } });
    return {
      result: { id: memberId, role: role.name },
      log: { action: "member.role_changed", objectType: "WorkspaceMember", objectId: memberId, before: { role: member.role.name }, after: { role: role.name }, activity: { kind: "member.role_changed", summary: `${member.user.name} is now ${role.name}` } },
    };
  });
}

/**
 * Removes a member. Their leads and deals stay where they are, owned by them,
 * so nothing is lost — the response says how many need reassigning.
 */
export async function removeMember(ctx: AuthContext, memberId: string) {
  assertPermission(ctx, PERMISSIONS.USERS_MANAGE);
  const member = await scopedMember(ctx, memberId);
  assertCanGrant(ctx, member.role.permissions);
  if (isOwnerRole(member.role.permissions) && (await ownersOtherThan(ctx.workspaceId, memberId)) === 0) {
    throw new MutationError("This is the workspace's only owner, so they can't be removed. Make someone else an owner first.", "last_owner", 409);
  }
  const [leads, deals] = await Promise.all([
    db.lead.count({ where: { workspaceId: ctx.workspaceId, ownerId: member.userId, deletedAt: null } }),
    db.deal.count({ where: { workspaceId: ctx.workspaceId, ownerId: member.userId, deletedAt: null, status: "OPEN" } }),
  ]);
  return mutate(ctx, PERMISSIONS.USERS_MANAGE, async () => {
    await db.workspaceMember.update({ where: { id: memberId }, data: { deletedAt: new Date() } });
    return {
      result: { id: memberId, stillOwned: { leads, deals } },
      log: { action: "member.removed", objectType: "WorkspaceMember", objectId: memberId, before: { name: member.user.name, email: member.user.email, role: member.role.name }, activity: { kind: "member.removed", summary: `${member.user.name} was removed from the workspace` } },
    };
  });
}
