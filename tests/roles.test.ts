import { afterAll, describe, expect, it } from "vitest";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { createRole, listRoles, updateRole } from "@/lib/services/roles";
import { PERMISSIONS } from "@/lib/auth/permissions";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
async function workspace() { const w = await makeWorkspace("Roles"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id); return w; }

describe("custom roles", () => {
  it("creates and edits a custom role within the editor's own permissions, and never edits a system role", async () => {
    const w = await workspace(); const other = await workspace();
    const r = await createRole(w.ctx, { name: "Researcher", permissions: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.LEADS_EDIT] });
    expect(r).toMatchObject({ isSystem: false, permissions: [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.LEADS_EDIT] });
    await expect(createRole(w.ctx, { name: "researcher", permissions: [PERMISSIONS.LEADS_VIEW_OWN] })).rejects.toThrow(/already exists/);
    await expect(createRole(w.ctx, { name: "Bogus", permissions: ["root.everything"] })).rejects.toThrow();
    await expect(updateRole(other.ctx, r.id, { name: "Hijack", permissions: [PERMISSIONS.LEADS_VIEW_OWN] })).rejects.toThrow();
    await updateRole(w.ctx, r.id, { name: "Researcher", permissions: [PERMISSIONS.LEADS_VIEW_OWN] });
    expect((await listRoles(w.ctx)).find(x => x.id === r.id)?.permissions).toEqual([PERMISSIONS.LEADS_VIEW_OWN]);
    const system = (await listRoles(w.ctx)).find(x => x.isSystem)!;
    await expect(updateRole(w.ctx, system.id, { name: system.name, permissions: [PERMISSIONS.LEADS_VIEW_OWN] })).rejects.toThrow(/System roles are fixed/);
  });
  it("refuses to grant a permission the editor lacks, and refuses self-lockout", async () => {
    const w = await workspace();
    const limited = { ...w.ctx, permissions: [PERMISSIONS.ROLES_MANAGE, PERMISSIONS.LEADS_VIEW_OWN] };
    await expect(createRole(limited, { name: "Too much", permissions: [PERMISSIONS.BILLING_MANAGE] })).rejects.toThrow(/don't hold/);
    const mine = await createRole(w.ctx, { name: "Admins", permissions: [PERMISSIONS.ROLES_MANAGE, PERMISSIONS.USERS_MANAGE] });
    await db.workspaceMember.updateMany({ where: { workspaceId: w.workspace.id, userId: w.user.id }, data: { roleId: mine.id } });
    await expect(updateRole(w.ctx, mine.id, { name: "Admins", permissions: [PERMISSIONS.USERS_MANAGE] })).rejects.toThrow(/your own ability/);
  });
});
