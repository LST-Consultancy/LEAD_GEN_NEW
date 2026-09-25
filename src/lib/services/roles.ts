import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError, loadScoped } from "./mutate";

const ALL = Object.values(PERMISSIONS) as string[];
const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).nullable().default(null),
  permissions: z.array(z.string()).min(1, "Give the role at least one permission.").max(ALL.length).refine(ps => ps.every(p => ALL.includes(p)), "One of those is not a permission this product knows."),
});

/** Every role with how many members and pending invitations hold it. */
export async function listRoles(ctx: AuthContext) {
  const roles = await db.role.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: [{ isSystem: "desc" }, { name: "asc" }], include: { _count: { select: { members: { where: { deletedAt: null } }, invitations: { where: { acceptedAt: null, revokedAt: null } } } } } });
  return toPlain(roles.map(r => ({ id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem, permissions: r.permissions, members: r._count.members, pendingInvitations: r._count.invitations })));
}

/** A role may only hold permissions its creator holds: nobody can mint authority they lack. */
function assertWithinOwn(ctx: AuthContext, permissions: string[]) {
  const beyond = permissions.filter(p => !ctx.permissions.includes(p));
  if (beyond.length) throw new MutationError(`You can't put permissions you don't hold into a role (${beyond.join(", ")}).`, "role_exceeds_yours", 403);
}

export async function createRole(ctx: AuthContext, raw: unknown) {
  const input = roleSchema.parse(raw ?? {});
  assertWithinOwn(ctx, input.permissions);
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "role";
  if (await db.role.findFirst({ where: { workspaceId: ctx.workspaceId, name: { equals: input.name, mode: "insensitive" } } })) throw new MutationError("A role with that name already exists.", "duplicate_role", 409);
  return mutate(ctx, PERMISSIONS.ROLES_MANAGE, async () => {
    const role = await db.role.create({ data: { workspaceId: ctx.workspaceId, key: `custom_${slug}_${Date.now().toString(36)}`, name: input.name, description: input.description, isSystem: false, permissions: [...new Set(input.permissions)] as Permission[] } });
    return { result: toPlain(role), log: { action: "role.created", objectType: "Role", objectId: role.id, after: { name: role.name, permissions: role.permissions } } };
  });
}

/**
 * Edits a custom role. System roles are fixed (copy one to customise it). A change that would take
 * role management away from the person making it is refused, so nobody locks themselves out.
 * Members holding the role get the new permissions on their next request.
 */
export async function updateRole(ctx: AuthContext, id: string, raw: unknown) {
  z.string().uuid().parse(id);
  const input = roleSchema.parse(raw ?? {});
  const role = await loadScoped(() => db.role.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That role");
  if (role.isSystem) throw new MutationError("System roles are fixed. Create a custom role from it instead.", "system_role", 409);
  assertWithinOwn(ctx, input.permissions);
  const removed = role.permissions.filter(p => !input.permissions.includes(p));
  assertWithinOwn(ctx, removed); // taking away a permission you don't hold is granting-by-proxy's mirror; refuse both
  const mine = await db.workspaceMember.findFirst({ where: { workspaceId: ctx.workspaceId, userId: ctx.userId, deletedAt: null }, select: { roleId: true } });
  if (mine?.roleId === role.id && !input.permissions.includes(PERMISSIONS.ROLES_MANAGE)) throw new MutationError("That would remove your own ability to manage roles. Ask another admin, or keep roles.manage in this role.", "self_lockout", 409);
  if (await db.role.findFirst({ where: { workspaceId: ctx.workspaceId, id: { not: id }, name: { equals: input.name, mode: "insensitive" } } })) throw new MutationError("A role with that name already exists.", "duplicate_role", 409);
  return mutate(ctx, PERMISSIONS.ROLES_MANAGE, async () => {
    const updated = await db.role.update({ where: { id }, data: { name: input.name, description: input.description, permissions: [...new Set(input.permissions)] as Permission[] } });
    return { result: toPlain(updated), log: { action: "role.updated", objectType: "Role", objectId: id, before: { name: role.name, permissions: role.permissions }, after: { name: updated.name, permissions: updated.permissions } } };
  });
}
