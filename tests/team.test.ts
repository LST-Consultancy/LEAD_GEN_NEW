import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, cleanup } from "./helpers/fixtures";
import { SYSTEM_ROLES } from "@/lib/auth/permissions";
import {
  acceptInvitation,
  assignableRoles,
  changeMemberRole,
  createInvitation,
  listInvitations,
  previewInvitation,
  removeMember,
  resendInvitation,
  revokeInvitation,
} from "@/lib/services/team";
import { createApiKey } from "@/lib/services/api-keys";
import { authenticateApiKey } from "@/lib/auth/api-key";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => {
  // Users created by accepting an invitation are not in the fixture's lists.
  const invited = await db.user.findMany({ where: { email: { endsWith: "@invitee.invalid" } }, select: { id: true } });
  created.userIds.push(...invited.map((u) => u.id));
  await cleanup(created); await db.$disconnect();
});
const PASSWORD = "Invitee-Pass-2026";
let seq = 0;
const email = () => `person${++seq}-${Date.now()}@invitee.invalid`;

async function workspace() {
  const w = await makeWorkspace("Team");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  const role = async (key: keyof typeof SYSTEM_ROLES) => (await db.role.findFirst({ where: { workspaceId: w.workspace.id, key } })) ?? db.role.create({ data: { workspaceId: w.workspace.id, key, name: SYSTEM_ROLES[key].name, permissions: SYSTEM_ROLES[key].permissions } });
  return { ...w, roles: { owner: await role("owner"), admin: await role("admin"), rep: await role("sales_rep"), viewer: await role("viewer") } };
}
const ownerMember = (workspaceId: string, userId: string) => db.workspaceMember.findFirstOrThrow({ where: { workspaceId, userId } });

describe("invitations", () => {
  it("creates an account and a membership, once", async () => {
    const w = await workspace();
    const address = email();
    const inv = await createInvitation(w.ctx, { email: address, roleId: w.roles.rep.id });
    expect(await db.invitation.count({ where: { tokenHash: inv.token } })).toBe(0);   // only the hash is stored
    expect(await previewInvitation(inv.token)).toMatchObject({ state: "valid", email: address, hasAccount: false });

    await expect(acceptInvitation(inv.token, { name: "New Person", password: "short" }, null)).rejects.toMatchObject({ code: "weak_password" });
    const joined = await acceptInvitation(inv.token, { name: "New Person", password: PASSWORD }, null);
    const member = await db.workspaceMember.findUniqueOrThrow({ where: { id: joined.memberId }, include: { role: true } });
    expect(member.role.id).toBe(w.roles.rep.id);
    await expect(acceptInvitation(inv.token, { name: "Again", password: PASSWORD }, null)).rejects.toMatchObject({ status: 410 });
    expect(await db.workspaceMember.count({ where: { workspaceId: w.workspace.id, userId: joined.userId } })).toBe(1);
    expect(await db.auditLog.count({ where: { workspaceId: w.workspace.id, action: "invitation.accepted" } })).toBe(1);
  });

  it("rejects expired, revoked and superseded links", async () => {
    const w = await workspace();
    const expired = await createInvitation(w.ctx, { email: email(), roleId: w.roles.rep.id });
    await db.invitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvitation(expired.token, { name: "X Person", password: PASSWORD }, null)).rejects.toMatchObject({ code: "invitation_expired" });

    const revoked = await createInvitation(w.ctx, { email: email(), roleId: w.roles.rep.id });
    await revokeInvitation(w.ctx, revoked.id);
    await expect(acceptInvitation(revoked.token, { name: "X Person", password: PASSWORD }, null)).rejects.toMatchObject({ code: "invitation_revoked" });

    const first = await createInvitation(w.ctx, { email: email(), roleId: w.roles.rep.id });
    const second = await resendInvitation(w.ctx, first.id);
    expect(await previewInvitation(first.token)).toEqual({ state: "invalid" });
    expect((await previewInvitation(second.token)).state).toBe("valid");
    expect(await previewInvitation("not-a-real-token-at-all-xyz")).toEqual({ state: "invalid" });
  });

  it("an existing account must be signed in as itself to accept", async () => {
    const w = await workspace(); const other = await workspace();
    const inv = await createInvitation(w.ctx, { email: other.user.email, roleId: w.roles.viewer.id });
    expect((await previewInvitation(inv.token)).state === "valid" && (await previewInvitation(inv.token) as { hasAccount: boolean }).hasAccount).toBe(true);
    await expect(acceptInvitation(inv.token, {}, null)).rejects.toMatchObject({ code: "sign_in_required" });
    await expect(acceptInvitation(inv.token, {}, w.user.id)).rejects.toMatchObject({ code: "sign_in_required" });
    const joined = await acceptInvitation(inv.token, {}, other.user.id);
    expect(joined.userId).toBe(other.user.id);
    // Their password is untouched.
    expect((await db.user.findUniqueOrThrow({ where: { id: other.user.id } })).passwordHash).toBe(other.user.passwordHash);
  });

  it("refuses duplicates and roles beyond the inviter's own", async () => {
    const w = await workspace();
    const admin = await addMember(w.workspace.id, "TeamAdmin", "admin"); created.userIds.push(admin.userId);
    const address = email();
    await createInvitation(w.ctx, { email: address, roleId: w.roles.rep.id });
    await expect(createInvitation(w.ctx, { email: address, roleId: w.roles.rep.id })).rejects.toMatchObject({ code: "already_invited" });
    await expect(createInvitation(w.ctx, { email: w.user.email, roleId: w.roles.rep.id })).rejects.toMatchObject({ code: "already_member" });
    await expect(createInvitation(admin, { email: email(), roleId: w.roles.owner.id })).rejects.toMatchObject({ code: "role_exceeds_yours" });
    expect((await assignableRoles(admin)).map((r) => r.id)).not.toContain(w.roles.owner.id);
    await expect(createInvitation(w.ctx, { email: "not-an-email", roleId: w.roles.rep.id })).rejects.toThrow(/isn't an email/);
  });

  it("is managed only by users.manage and only within the workspace", async () => {
    const w = await workspace(); const other = await workspace();
    const viewer = await addMember(w.workspace.id, "TeamViewer", "viewer"); created.userIds.push(viewer.userId);
    await expect(createInvitation(viewer, { email: email(), roleId: w.roles.viewer.id })).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(listInvitations(viewer)).rejects.toMatchObject({ name: "ForbiddenError" });
    const inv = await createInvitation(w.ctx, { email: email(), roleId: w.roles.rep.id });
    await expect(revokeInvitation(other.ctx, inv.id)).rejects.toMatchObject({ status: 404 });
    await expect(createInvitation(other.ctx, { email: email(), roleId: w.roles.rep.id })).rejects.toMatchObject({ status: 404 });
  });
});

describe("members", () => {
  it("a role change narrows access immediately, API keys included", async () => {
    const w = await workspace();
    const manager = await addMember(w.workspace.id, "TeamManager", "admin"); created.userIds.push(manager.userId);
    const key = await createApiKey(manager, { name: "Export", scopes: ["leads.read"] });
    const before = await authenticateApiKey(key.plaintext);
    expect(before.ok && before.ctx.permissions.includes("leads.view_all")).toBe(true);
    await changeMemberRole(w.ctx, manager.memberId, { roleId: w.roles.rep.id });
    const after = await authenticateApiKey(key.plaintext);
    expect(after.ok && after.ctx.permissions.includes("leads.view_all")).toBe(false);
  });

  it("never leaves a workspace without an owner", async () => {
    const w = await workspace();
    const me = await ownerMember(w.workspace.id, w.user.id);
    await expect(changeMemberRole(w.ctx, me.id, { roleId: w.roles.rep.id })).rejects.toMatchObject({ code: "last_owner" });
    await expect(removeMember(w.ctx, me.id)).rejects.toMatchObject({ code: "last_owner" });
    const second = await addMember(w.workspace.id, "SecondOwner", "owner"); created.userIds.push(second.userId);
    await changeMemberRole(w.ctx, me.id, { roleId: w.roles.admin.id });
    expect((await db.workspaceMember.findUniqueOrThrow({ where: { id: me.id } })).roleId).toBe(w.roles.admin.id);
  });

  it("an admin cannot demote or remove an owner", async () => {
    const w = await workspace();
    const admin = await addMember(w.workspace.id, "TeamAdmin2", "admin"); created.userIds.push(admin.userId);
    const me = await ownerMember(w.workspace.id, w.user.id);
    await expect(changeMemberRole(admin, me.id, { roleId: w.roles.rep.id })).rejects.toMatchObject({ code: "role_exceeds_yours" });
    await expect(removeMember(admin, me.id)).rejects.toMatchObject({ code: "role_exceeds_yours" });
  });

  it("removal ends access, keeps their records, and a re-invite restores them", async () => {
    const w = await workspace();
    const rep = await addMember(w.workspace.id, "TeamRep", "sales_rep"); created.userIds.push(rep.userId);
    const r = await removeMember(w.ctx, rep.memberId);
    expect(r.stillOwned).toEqual({ leads: 0, deals: 0 });
    expect(await db.workspaceMember.count({ where: { id: rep.memberId, deletedAt: null } })).toBe(0);
    const inv = await createInvitation(w.ctx, { email: rep.user.email, roleId: w.roles.viewer.id });
    await acceptInvitation(inv.token, {}, rep.userId);
    const back = await db.workspaceMember.findUniqueOrThrow({ where: { id: rep.memberId } });
    expect(back.deletedAt).toBeNull(); expect(back.roleId).toBe(w.roles.viewer.id);
  });
});
