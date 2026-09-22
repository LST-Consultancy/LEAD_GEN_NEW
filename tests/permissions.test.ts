import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  hasPermission,
  hasAnyPermission,
} from "@/lib/auth/permissions";
import { assertPermission, ForbiddenError, leadVisibilityFilter } from "@/lib/auth/context";
import type { AuthContext } from "@/lib/auth/context";
import { passwordProblems } from "@/lib/auth/password";

function ctxWith(permissions: string[]): AuthContext {
  return {
    userId: "u1",
    sessionId: "s1",
    user: { id: "u1", name: "Test", email: "t@test.invalid", avatarUrl: null, timezone: "Asia/Kolkata" },
    workspaceId: "w1",
    workspace: {
      id: "w1",
      name: "W",
      slug: "w",
      currency: "INR",
      timezone: "Asia/Kolkata",
      logoUrl: null,
      autopilotMode: "OFF",
      onboardedAt: null,
    },
    memberId: "m1",
    roleKey: "test",
    roleName: "Test",
    permissions,
    workspaces: [],
  };
}

describe("role definitions", () => {
  it("gives the owner every permission", () => {
    const all = Object.values(PERMISSIONS);
    expect(SYSTEM_ROLES.owner.permissions.sort()).toEqual([...all].sort());
  });

  it("withholds billing management and workspace deletion from admins", () => {
    expect(SYSTEM_ROLES.admin.permissions).not.toContain(PERMISSIONS.BILLING_MANAGE);
    expect(SYSTEM_ROLES.admin.permissions).not.toContain(PERMISSIONS.WORKSPACE_MANAGE);
    expect(SYSTEM_ROLES.admin.permissions).toContain(PERMISSIONS.USERS_MANAGE);
  });

  it("stops a researcher from contacting anyone", () => {
    const r = SYSTEM_ROLES.researcher.permissions;
    expect(r).toContain(PERMISSIONS.LEADS_REVEAL);
    expect(r).toContain(PERMISSIONS.POINTS_SPEND);
    expect(r).not.toContain(PERMISSIONS.OUTREACH_SEND);
    expect(r).not.toContain(PERMISSIONS.PROPOSALS_SEND);
  });

  it("limits a sales rep to their own leads", () => {
    const r = SYSTEM_ROLES.sales_rep.permissions;
    expect(r).toContain(PERMISSIONS.LEADS_VIEW_OWN);
    expect(r).not.toContain(PERMISSIONS.LEADS_VIEW_ALL);
    expect(r).not.toContain(PERMISSIONS.LEADS_EXPORT);
  });

  it("makes a viewer strictly read-only", () => {
    const r = SYSTEM_ROLES.viewer.permissions;
    expect(r).toEqual([PERMISSIONS.LEADS_VIEW_ALL, PERMISSIONS.LEADS_VIEW_OWN]);
    for (const write of [
      PERMISSIONS.LEADS_EDIT,
      PERMISSIONS.OUTREACH_SEND,
      PERMISSIONS.PIPELINE_EDIT,
      PERMISSIONS.POINTS_SPEND,
      PERMISSIONS.DATA_DELETE,
    ]) {
      expect(r).not.toContain(write);
    }
  });

  it("keeps every role's permissions inside the declared catalogue", () => {
    const all = new Set<string>(Object.values(PERMISSIONS));
    for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
      for (const p of role.permissions) {
        expect(all.has(p), `${key} grants unknown permission ${p}`).toBe(true);
      }
    }
  });
});

describe("permission checks", () => {
  it("answers hasPermission exactly", () => {
    expect(hasPermission([PERMISSIONS.LEADS_EDIT], PERMISSIONS.LEADS_EDIT)).toBe(true);
    expect(hasPermission([PERMISSIONS.LEADS_EDIT], PERMISSIONS.LEADS_REVEAL)).toBe(false);
    expect(hasPermission([], PERMISSIONS.LEADS_EDIT)).toBe(false);
  });

  it("answers hasAnyPermission", () => {
    expect(
      hasAnyPermission([PERMISSIONS.LEADS_VIEW_OWN], [
        PERMISSIONS.LEADS_VIEW_ALL,
        PERMISSIONS.LEADS_VIEW_OWN,
      ])
    ).toBe(true);
    expect(hasAnyPermission([], [PERMISSIONS.LEADS_VIEW_ALL])).toBe(false);
  });

  it("throws ForbiddenError naming the missing permission", () => {
    const ctx = ctxWith([PERMISSIONS.LEADS_VIEW_OWN]);
    expect(() => assertPermission(ctx, PERMISSIONS.LEADS_VIEW_OWN)).not.toThrow();
    try {
      assertPermission(ctx, PERMISSIONS.BILLING_MANAGE);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).permission).toBe(PERMISSIONS.BILLING_MANAGE);
    }
  });
});

describe("lead visibility filter", () => {
  it("returns an empty filter for anyone who may see all leads", () => {
    expect(leadVisibilityFilter(ctxWith([PERMISSIONS.LEADS_VIEW_ALL]))).toEqual({});
  });

  it("scopes to the caller when they may only see their own", () => {
    const ctx = ctxWith([PERMISSIONS.LEADS_VIEW_OWN]);
    expect(leadVisibilityFilter(ctx)).toEqual({ ownerId: ctx.userId });
  });

  it("scopes to the caller when they hold no view permission at all", () => {
    const ctx = ctxWith([]);
    expect(leadVisibilityFilter(ctx)).toEqual({ ownerId: ctx.userId });
  });
});

describe("password policy", () => {
  it("accepts a compliant password", () => {
    expect(passwordProblems("Signalroom123")).toEqual([]);
  });

  it("names every problem rather than just the first", () => {
    const problems = passwordProblems("abc");
    expect(problems).toHaveLength(3);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("10 characters"),
        expect.stringContaining("uppercase"),
        expect.stringContaining("number"),
      ])
    );
  });

  it("requires a mix of cases and a digit", () => {
    expect(passwordProblems("alllowercase1")).toEqual([expect.stringContaining("uppercase")]);
    expect(passwordProblems("ALLUPPERCASE1")).toEqual([expect.stringContaining("lowercase")]);
    expect(passwordProblems("NoDigitsHere")).toEqual([expect.stringContaining("number")]);
  });
});
