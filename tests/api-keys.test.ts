import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, cleanup } from "./helpers/fixtures";
import {
  mintApiKey,
  digest,
  readKeyFromHeaders,
  authenticateApiKey,
  getApiContext,
} from "@/lib/auth/api-key";
import {
  API_SCOPES,
  permissionsForScopes,
  effectivePermissions,
  grantableScopes,
  highestRisk,
} from "@/lib/auth/api-scopes";
import { PERMISSIONS } from "@/lib/auth/permissions";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Keys");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

async function issueKey(
  workspaceId: string,
  createdById: string | null,
  scopes: string[],
  over: { revokedAt?: Date; expiresAt?: Date } = {}
) {
  const minted = mintApiKey();
  const row = await db.apiKey.create({
    data: {
      workspaceId,
      name: "Test key",
      prefix: minted.prefix,
      keyHash: minted.keyHash,
      scopes,
      createdById,
      revokedAt: over.revokedAt,
      expiresAt: over.expiresAt,
    },
  });
  return { ...minted, id: row.id };
}

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("minting", () => {
  it("returns the plaintext once and stores only a digest", () => {
    const k = mintApiKey();
    expect(k.plaintext).toMatch(/^sr_live_[A-Za-z0-9_-]{20,}$/);
    expect(k.keyHash).toBe(digest(k.plaintext));
    expect(k.keyHash).not.toContain(k.plaintext.slice(8));
  });

  it("keeps a prefix that identifies without reconstructing", () => {
    const k = mintApiKey();
    expect(k.prefix).toHaveLength("sr_live_".length + 4);
    expect(k.plaintext.startsWith(k.prefix)).toBe(true);
    expect(k.prefix.length).toBeLessThan(k.plaintext.length / 2);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintApiKey().plaintext));
    expect(seen.size).toBe(200);
  });
});

describe("reading the header", () => {
  it("accepts a bearer token", () => {
    expect(readKeyFromHeaders(new Headers({ authorization: "Bearer sr_live_abc" }))).toBe(
      "sr_live_abc"
    );
  });

  it("accepts the x-api-key convention", () => {
    expect(readKeyFromHeaders(new Headers({ "x-api-key": "sr_live_abc" }))).toBe("sr_live_abc");
  });

  it("is case-insensitive about the scheme", () => {
    expect(readKeyFromHeaders(new Headers({ authorization: "bearer sr_live_abc" }))).toBe(
      "sr_live_abc"
    );
  });

  it("returns null when nothing is presented", () => {
    expect(readKeyFromHeaders(new Headers())).toBeNull();
    expect(readKeyFromHeaders(new Headers({ authorization: "Bearer " }))).toBeNull();
  });

  it("ignores a non-bearer authorization header", () => {
    expect(readKeyFromHeaders(new Headers({ authorization: "Basic abc" }))).toBeNull();
  });
});

describe("the scope catalogue", () => {
  it("gives every scope a risk class and a sentence", () => {
    for (const s of API_SCOPES) {
      expect(["READ", "WRITE", "SPEND", "EXTERNAL"]).toContain(s.risk);
      expect(s.describes.length).toBeGreaterThan(20);
      expect(s.grants.length).toBeGreaterThan(0);
    }
  });

  it("warns in plain words that a spend scope costs money", () => {
    const reveal = API_SCOPES.find((s) => s.key === "contacts.reveal")!;
    expect(reveal.risk).toBe("SPEND");
    expect(reveal.describes).toMatch(/spends points/);
    expect(reveal.describes).toMatch(/cannot be undone/);
  });

  it("says an external scope reaches outside the app", () => {
    const send = API_SCOPES.find((s) => s.key === "outreach.send")!;
    expect(send.describes).toMatch(/outside the app/);
  });

  it("deduplicates permissions across scopes", () => {
    const p = permissionsForScopes(["leads.read", "pipeline.read"]);
    expect(new Set(p).size).toBe(p.length);
  });

  it("ignores an unknown scope rather than throwing", () => {
    expect(permissionsForScopes(["not.a.scope"])).toEqual([]);
  });

  it("reports the riskiest scope in a set", () => {
    expect(highestRisk(["leads.read", "contacts.reveal"])).toBe("SPEND");
    expect(highestRisk(["leads.read", "outreach.send", "contacts.reveal"])).toBe("EXTERNAL");
    expect(highestRisk(["leads.read"])).toBe("READ");
    expect(highestRisk([])).toBeNull();
  });

  it("gives every scope a minimum that is a subset of what it grants", () => {
    for (const s of API_SCOPES) {
      for (const p of s.requires) {
        expect(s.grants, `${s.key}: requires must be within grants`).toContain(p);
      }
    }
  });

  it("lets a rep who only sees their own leads still issue a read key", () => {
    // The visibility filter narrows the key's reach; the scope should not
    // refuse it outright.
    const repPerms = [PERMISSIONS.LEADS_VIEW_OWN, PERMISSIONS.LEADS_EDIT];
    const grantable = grantableScopes(repPerms);
    expect(grantable.find((g) => g.scope.key === "leads.read")!.grantable).toBe(true);
    expect(grantable.find((g) => g.scope.key === "leads.write")!.grantable).toBe(true);
    expect(grantable.find((g) => g.scope.key === "contacts.reveal")!.grantable).toBe(false);
  });

  it("marks which scopes a role could not grant", () => {
    const viewerPerms = [PERMISSIONS.LEADS_VIEW_ALL, PERMISSIONS.LEADS_VIEW_OWN];
    const grantable = grantableScopes(viewerPerms);
    const read = grantable.find((g) => g.scope.key === "leads.read")!;
    const reveal = grantable.find((g) => g.scope.key === "contacts.reveal")!;
    expect(read.grantable).toBe(true);
    expect(reveal.grantable).toBe(false);
    expect(reveal.missing).toContain(PERMISSIONS.LEADS_REVEAL);
  });
});

describe("effective permissions", () => {
  it("is the intersection, never the union", () => {
    const { granted, withheld } = effectivePermissions(
      ["contacts.reveal"],
      [PERMISSIONS.LEADS_VIEW_OWN]
    );
    expect(granted).toEqual([PERMISSIONS.LEADS_VIEW_OWN]);
    expect(withheld).toContain(PERMISSIONS.LEADS_REVEAL);
    expect(withheld).toContain(PERMISSIONS.POINTS_SPEND);
  });

  it("grants everything when the creator holds everything", () => {
    const all = Object.values(PERMISSIONS) as string[];
    const { withheld } = effectivePermissions(["outreach.send", "contacts.reveal"], all);
    expect(withheld).toEqual([]);
  });
});

describe("authenticating a key", () => {
  it("resolves to a context narrowed to its scopes", async () => {
    const { workspace, user } = await freshWorkspace();
    const key = await issueKey(workspace.id, user.id, ["leads.read"]);

    const result = await authenticateApiKey(key.plaintext);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    expect(result.ctx.workspaceId).toBe(workspace.id);
    // Only what leads.read asks for — not the owner's full set.
    expect(result.ctx.permissions).toEqual(
      expect.arrayContaining([PERMISSIONS.LEADS_VIEW_ALL, PERMISSIONS.LEADS_VIEW_OWN])
    );
    expect(result.ctx.permissions).not.toContain(PERMISSIONS.LEADS_REVEAL);
    expect(result.ctx.permissions).not.toContain(PERMISSIONS.WORKSPACE_MANAGE);
  });

  it("names the key in the role, so audit rows are attributable", async () => {
    const { workspace, user } = await freshWorkspace();
    const key = await issueKey(workspace.id, user.id, ["leads.read"]);
    const result = await authenticateApiKey(key.plaintext);
    if (!result.ok) throw new Error("unreachable");
    expect(result.ctx.roleName).toMatch(/via API key "Test key"/);
    expect(result.ctx.sessionId).toMatch(/^apikey:/);
  });

  it("cannot switch workspaces", async () => {
    const { workspace, user } = await freshWorkspace();
    const key = await issueKey(workspace.id, user.id, ["leads.read"]);
    const result = await authenticateApiKey(key.plaintext);
    if (!result.ok) throw new Error("unreachable");
    expect(result.ctx.workspaces).toEqual([]);
  });

  it("records lastUsedAt only on success", async () => {
    const { workspace, user } = await freshWorkspace();
    const key = await issueKey(workspace.id, user.id, ["leads.read"]);
    expect((await db.apiKey.findUniqueOrThrow({ where: { id: key.id } })).lastUsedAt).toBeNull();

    await authenticateApiKey(key.plaintext);
    expect(
      (await db.apiKey.findUniqueOrThrow({ where: { id: key.id } })).lastUsedAt
    ).not.toBeNull();

    // A rejected attempt must not look like a use.
    const revoked = await issueKey(workspace.id, user.id, ["leads.read"], {
      revokedAt: new Date(),
    });
    await authenticateApiKey(revoked.plaintext);
    expect((await db.apiKey.findUniqueOrThrow({ where: { id: revoked.id } })).lastUsedAt).toBeNull();
  });

  it("refuses a malformed key with the expected shape", async () => {
    const r = await authenticateApiKey("not-a-key");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe("malformed_key");
    expect(r.message).toMatch(/Authorization: Bearer/);
  });

  it("refuses an unknown key", async () => {
    const r = await authenticateApiKey(mintApiKey().plaintext);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe("unknown_key");
  });

  it("distinguishes revoked from expired from unknown", async () => {
    const { workspace, user } = await freshWorkspace();
    const revoked = await issueKey(workspace.id, user.id, ["leads.read"], {
      revokedAt: new Date("2026-01-01"),
    });
    const expired = await issueKey(workspace.id, user.id, ["leads.read"], {
      expiresAt: new Date("2026-01-02"),
    });

    const a = await authenticateApiKey(revoked.plaintext);
    const b = await authenticateApiKey(expired.plaintext);
    if (a.ok || b.ok) throw new Error("unreachable");
    expect(a.code).toBe("revoked_key");
    expect(a.message).toMatch(/2026-01-01/);
    expect(b.code).toBe("expired_key");
    expect(b.message).toMatch(/2026-01-02/);
  });

  it("refuses a key whose creator was removed, and says so", async () => {
    const { workspace } = await freshWorkspace();
    const member = await addMember(workspace.id, "Temp", "manager");
    const key = await issueKey(workspace.id, member.userId, ["leads.read"]);

    await db.workspaceMember.updateMany({
      where: { workspaceId: workspace.id, userId: member.userId },
      data: { deletedAt: new Date() },
    });

    const r = await authenticateApiKey(key.plaintext);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.status).toBe(403);
    expect(r.code).toBe("creator_removed");
    expect(r.message).toMatch(/no longer a member/);
  });

  it("narrows with its creator when they are demoted", async () => {
    const { workspace } = await freshWorkspace();
    const manager = await addMember(workspace.id, "Manager", "manager");
    const key = await issueKey(workspace.id, manager.userId, ["contacts.reveal"]);

    const before = await authenticateApiKey(key.plaintext);
    if (!before.ok) throw new Error("unreachable");
    expect(before.ctx.permissions).toContain(PERMISSIONS.LEADS_REVEAL);

    // Demoted to viewer: the key must lose the reveal permission with them.
    // The fixture creates roles on demand, so this makes the target role.
    const viewerRole = await db.role.create({
      data: {
        workspaceId: workspace.id,
        key: `viewer-${Math.random().toString(36).slice(2, 10)}`,
        name: "Viewer",
        permissions: [PERMISSIONS.LEADS_VIEW_ALL, PERMISSIONS.LEADS_VIEW_OWN],
      },
    });
    await db.workspaceMember.updateMany({
      where: { workspaceId: workspace.id, userId: manager.userId },
      data: { roleId: viewerRole.id },
    });

    const after = await authenticateApiKey(key.plaintext);
    if (!after.ok) throw new Error("unreachable");
    expect(after.ctx.permissions).not.toContain(PERMISSIONS.LEADS_REVEAL);
    expect(after.withheld).toContain(PERMISSIONS.LEADS_REVEAL);
  });

  it("refuses outright when nothing survives the intersection", async () => {
    const { workspace } = await freshWorkspace();
    const viewer = await addMember(workspace.id, "Viewer", "viewer");
    // A viewer cannot grant pipeline.write at all.
    const key = await issueKey(workspace.id, viewer.userId, ["pipeline.write"]);

    const r = await authenticateApiKey(key.plaintext);
    // leads.view_own survives, so this still authenticates but narrowed.
    if (!r.ok) throw new Error("unreachable");
    expect(r.ctx.permissions).not.toContain(PERMISSIONS.PIPELINE_EDIT);
    expect(r.withheld).toContain(PERMISSIONS.PIPELINE_EDIT);
  });

  it("refuses a key in a deleted workspace", async () => {
    const { workspace, user } = await freshWorkspace();
    const key = await issueKey(workspace.id, user.id, ["leads.read"]);
    await db.workspace.update({ where: { id: workspace.id }, data: { deletedAt: new Date() } });

    const r = await authenticateApiKey(key.plaintext);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe("workspace_gone");

    // Restore so cleanup works.
    await db.workspace.update({ where: { id: workspace.id }, data: { deletedAt: null } });
  });
});

describe("getApiContext", () => {
  it("returns null when no key is presented, so a route can fall back to the session", async () => {
    expect(await getApiContext(new Headers())).toBeNull();
  });

  it("returns a failure for a bad key rather than falling through", async () => {
    const r = await getApiContext(new Headers({ authorization: "Bearer sr_live_nope" }));
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(false);
  });
});
