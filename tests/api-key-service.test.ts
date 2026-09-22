import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, cleanup } from "./helpers/fixtures";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  getApiSurface,
} from "@/lib/services/api-keys";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { ForbiddenError } from "@/lib/auth/context";
import { ENDPOINTS, KEY_ENDPOINTS } from "@/lib/api/manifest";
import { SCOPE_INDEX } from "@/lib/auth/api-scopes";
import { PERMISSIONS } from "@/lib/auth/permissions";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("KeySvc");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("the manifest", () => {
  it("gives every key-accepting endpoint a scope that exists", () => {
    for (const e of KEY_ENDPOINTS) {
      expect(e.scope, `${e.method} ${e.path} needs a scope`).not.toBeNull();
      expect(SCOPE_INDEX.has(e.scope!), `${e.scope} must be a real scope`).toBe(true);
    }
  });

  it("explains every endpoint that does not accept a key", () => {
    for (const e of ENDPOINTS.filter((x) => !x.keyAuth)) {
      expect(e.note, `${e.method} ${e.path} must say why not`).toBeTruthy();
      expect(e.note!.length).toBeGreaterThan(20);
    }
  });

  it("never exposes the guardrails or approvals to a key", () => {
    for (const path of ["/api/autopilot", "/api/agent-actions/{id}/decide"]) {
      const e = ENDPOINTS.find((x) => x.path === path)!;
      expect(e.keyAuth).toBe(false);
      expect(e.scope).toBeNull();
    }
  });
});

describe("creating a key", () => {
  it("returns the plaintext once and stores only a hash", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const result = await createApiKey(ctx, { name: "Reporting", scopes: ["leads.read"] });

    expect(result.plaintext).toMatch(/^sr_live_/);
    expect(result.note).toMatch(/only time it can be shown/);

    const row = await db.apiKey.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    // The plaintext is nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(result.plaintext.slice(8));
  });

  it("produces a key that actually authenticates", async () => {
    const { ctx } = await freshWorkspace();
    const result = await createApiKey(ctx, { name: "Live", scopes: ["leads.read"] });

    const auth = await authenticateApiKey(result.plaintext);
    expect(auth.ok).toBe(true);
    if (!auth.ok) throw new Error("unreachable");
    expect(auth.scopes).toEqual(["leads.read"]);
  });

  it("lists exactly which endpoints the new key can call", async () => {
    const { ctx } = await freshWorkspace();
    const result = await createApiKey(ctx, {
      name: "Pipeline reader",
      scopes: ["pipeline.read"],
    });
    expect(result.endpoints.length).toBeGreaterThan(0);
    expect(result.endpoints.every((e) => e.scope === "pipeline.read")).toBe(true);
  });

  it("refuses a scope the creator's role cannot grant", async () => {
    const { ctx, workspace } = await freshWorkspace();

    // A custom role that may manage keys but holds little else. Only owner and
    // admin carry api_keys.manage among the stock roles, and both hold
    // everything — so the ceiling check needs a narrower role to be exercised.
    const narrow = await db.role.create({
      data: {
        workspaceId: workspace.id,
        key: `keykeeper-${Math.random().toString(36).slice(2, 9)}`,
        name: "Key keeper",
        permissions: [PERMISSIONS.API_KEYS_MANAGE, PERMISSIONS.LEADS_VIEW_OWN],
      },
    });
    const user = await db.user.create({
      data: { name: "Key Keeper", email: `kk-${Math.random().toString(36).slice(2, 9)}@test.invalid` },
    });
    const member = await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, roleId: narrow.id },
    });

    const keeper = {
      ...ctx,
      userId: user.id,
      user: { ...ctx.user, id: user.id, name: "Key Keeper", email: user.email },
      memberId: member.id,
      roleKey: narrow.key,
      roleName: narrow.name,
      permissions: narrow.permissions,
    };

    // contacts.reveal needs leads.reveal and points.spend, which this role
    // does not hold — so the key would be born unable to do what it says.
    await expect(
      createApiKey(keeper, { name: "Beyond me", scopes: ["contacts.reveal"] })
    ).rejects.toThrow(/can never do more than the person who created it/);

    // A scope within its authority is fine.
    await expect(
      createApiKey(keeper, { name: "Within me", scopes: ["leads.read"] })
    ).resolves.toBeDefined();
  });

  it("refuses an unknown scope", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createApiKey(ctx, { name: "Bad", scopes: ["leads.teleport"] })
    ).rejects.toThrow(/not a scope this app defines/);
  });

  it("refuses no scopes at all", async () => {
    const { ctx } = await freshWorkspace();
    await expect(createApiKey(ctx, { name: "Empty", scopes: [] })).rejects.toThrow();
  });

  it("refuses a duplicate live name, because names are how you revoke", async () => {
    const { ctx } = await freshWorkspace();
    await createApiKey(ctx, { name: "Same", scopes: ["leads.read"] });
    await expect(
      createApiKey(ctx, { name: "Same", scopes: ["leads.read"] })
    ).rejects.toThrow(/Names are how you tell them apart/);
  });

  it("allows reusing the name of a revoked key", async () => {
    const { ctx } = await freshWorkspace();
    const first = await createApiKey(ctx, { name: "Rotating", scopes: ["leads.read"] });
    await revokeApiKey(ctx, first.key.id);
    await expect(
      createApiKey(ctx, { name: "Rotating", scopes: ["leads.read"] })
    ).resolves.toBeDefined();
  });

  it("warns differently for a key that never expires", async () => {
    const { ctx } = await freshWorkspace();
    const forever = await createApiKey(ctx, {
      name: "Forever",
      scopes: ["leads.read"],
      expiresInDays: null,
    });
    expect(forever.note).toMatch(/never expires/);
    expect(forever.key.expiresAt).toBeNull();
  });

  it("defaults to a 90-day expiry rather than forever", async () => {
    const { ctx } = await freshWorkspace();
    const k = await createApiKey(ctx, { name: "Default", scopes: ["leads.read"] });
    expect(k.key.expiresAt).not.toBeNull();
  });

  it("requires the api-keys permission", async () => {
    const { workspace } = await freshWorkspace();
    const manager = await addMember(workspace.id, "Manager", "manager");
    await expect(
      createApiKey(manager, { name: "Nope", scopes: ["leads.read"] })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("listing keys", () => {
  it("reports whether a key works, not just whether it was revoked", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await createApiKey(ctx, { name: "Live", scopes: ["leads.read"] });
    const expiring = await createApiKey(ctx, { name: "Expiring", scopes: ["leads.read"] });
    const revoked = await createApiKey(ctx, { name: "Gone", scopes: ["leads.read"] });

    await db.apiKey.update({
      where: { id: expiring.key.id },
      data: { expiresAt: new Date(Date.now() - 86_400_000) },
    });
    await revokeApiKey(ctx, revoked.key.id);

    const keys = await listApiKeys(ctx);
    const byName = new Map(keys.map((k) => [k.name, k]));
    expect(byName.get("Live")!.state).toBe("active");
    expect(byName.get("Expiring")!.state).toBe("expired");
    expect(byName.get("Gone")!.state).toBe("revoked");
    void workspace;
  });

  it("calls a key orphaned when its creator left", async () => {
    const { workspace } = await freshWorkspace();
    const owner2 = await addMember(workspace.id, "Owner2", "owner");
    const k = await createApiKey(owner2, { name: "Orphan", scopes: ["leads.read"] });

    await db.workspaceMember.updateMany({
      where: { workspaceId: workspace.id, userId: owner2.userId },
      data: { deletedAt: new Date() },
    });

    const keys = await listApiKeys(owner2);
    const found = keys.find((x) => x.id === k.key.id)!;
    expect(found.state).toBe("orphaned");
    expect(found.stateReason).toMatch(/no longer a member/);
  });

  it("calls a key powerless when its creator was demoted below its scopes", async () => {
    const { workspace } = await freshWorkspace();
    const owner2 = await addMember(workspace.id, "Owner3", "owner");
    const k = await createApiKey(owner2, { name: "Demoted", scopes: ["contacts.reveal"] });

    const viewerRole = await db.role.create({
      data: {
        workspaceId: workspace.id,
        key: `viewer-${Math.random().toString(36).slice(2, 9)}`,
        name: "Viewer",
        // Nothing contacts.reveal needs.
        permissions: [],
      },
    });
    await db.workspaceMember.updateMany({
      where: { workspaceId: workspace.id, userId: owner2.userId },
      data: { roleId: viewerRole.id },
    });

    const keys = await listApiKeys(owner2);
    const found = keys.find((x) => x.id === k.key.id)!;
    expect(found.state).toBe("powerless");
    expect(found.withheld.length).toBeGreaterThan(0);
  });

  it("never returns anything that could reconstruct a key", async () => {
    const { ctx } = await freshWorkspace();
    const made = await createApiKey(ctx, { name: "Secret", scopes: ["leads.read"] });
    const keys = await listApiKeys(ctx);
    const serialised = JSON.stringify(keys);
    expect(serialised).not.toContain(made.plaintext.slice(10));
    expect(serialised).not.toContain("keyHash");
  });

  it("flags a scope that no longer exists in the app", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const k = await createApiKey(ctx, { name: "Legacy", scopes: ["leads.read"] });
    await db.apiKey.update({
      where: { id: k.key.id },
      data: { scopes: ["leads.read", "some.removed.scope"] },
    });

    const keys = await listApiKeys(ctx);
    const found = keys.find((x) => x.id === k.key.id)!;
    expect(found.scopes.find((s) => s.key === "some.removed.scope")?.known).toBe(false);
    void workspace;
  });

  it("does not leak keys across workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await createApiKey(b.ctx, { name: "Theirs", scopes: ["leads.read"] });
    expect(await listApiKeys(a.ctx)).toHaveLength(0);
    expect(await listApiKeys(b.ctx)).toHaveLength(1);
  });
});

describe("revoking", () => {
  it("stops the key working immediately", async () => {
    const { ctx } = await freshWorkspace();
    const made = await createApiKey(ctx, { name: "Doomed", scopes: ["leads.read"] });
    expect((await authenticateApiKey(made.plaintext)).ok).toBe(true);

    await revokeApiKey(ctx, made.key.id);
    const after = await authenticateApiKey(made.plaintext);
    expect(after.ok).toBe(false);
    if (after.ok) throw new Error("unreachable");
    expect(after.code).toBe("revoked_key");
  });

  it("warns that things using it will start failing", async () => {
    const { ctx } = await freshWorkspace();
    const made = await createApiKey(ctx, { name: "InUse", scopes: ["leads.read"] });
    await authenticateApiKey(made.plaintext);

    const result = await revokeApiKey(ctx, made.key.id);
    expect(result.note).toMatch(/will start failing/);
  });

  it("says plainly when a revoked key was never used", async () => {
    const { ctx } = await freshWorkspace();
    const made = await createApiKey(ctx, { name: "Unused", scopes: ["leads.read"] });
    const result = await revokeApiKey(ctx, made.key.id);
    expect(result.note).toMatch(/never used/);
  });

  it("refuses to revoke twice", async () => {
    const { ctx } = await freshWorkspace();
    const made = await createApiKey(ctx, { name: "Twice", scopes: ["leads.read"] });
    await revokeApiKey(ctx, made.key.id);
    await expect(revokeApiKey(ctx, made.key.id)).rejects.toThrow(/already revoked/);
  });

  it("will not revoke another workspace's key", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const made = await createApiKey(b.ctx, { name: "Theirs", scopes: ["leads.read"] });
    await expect(revokeApiKey(a.ctx, made.key.id)).rejects.toThrow(
      /doesn't exist, or you don't have access/
    );
  });
});

describe("the surface description", () => {
  it("marks which scopes the viewer's own role could grant", async () => {
    const { workspace } = await freshWorkspace();
    const viewer = await addMember(workspace.id, "Viewer", "viewer");
    const surface = getApiSurface(viewer);
    const reveal = surface.scopes.find((s) => s.key === "contacts.reveal")!;
    const read = surface.scopes.find((s) => s.key === "leads.read")!;
    expect(read.grantable).toBe(true);
    expect(reveal.grantable).toBe(false);
    expect(reveal.missing.length).toBeGreaterThan(0);
  });

  it("reports how much of the surface accepts keys at all", async () => {
    const { ctx } = await freshWorkspace();
    const surface = getApiSurface(ctx);
    expect(surface.keyEndpointCount).toBeGreaterThan(0);
    expect(surface.totalEndpointCount).toBeGreaterThanOrEqual(surface.keyEndpointCount);
  });
});
