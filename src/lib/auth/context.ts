import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { readSession, readActiveWorkspace } from "@/lib/auth/session";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";

export type AuthContext = {
  userId: string;
  sessionId: string;
  user: { id: string; name: string; email: string; avatarUrl: string | null; timezone: string };
  workspaceId: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    timezone: string;
    logoUrl: string | null;
    autopilotMode: string;
    onboardedAt: Date | null;
  };
  memberId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  /** Every workspace this user can switch into. */
  workspaces: { id: string; name: string; slug: string; roleName: string }[];
};

/**
 * Resolves the caller's identity and active tenant exactly once per request.
 * `cache` dedupes across the many server components that need it.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await readSession();
  if (!session) return null;

  const memberships = await db.workspaceMember.findMany({
    where: { userId: session.userId, deletedAt: null, workspace: { deletedAt: null } },
    include: { workspace: true, role: true, user: true },
    orderBy: [{ isDefault: "desc" }, { joinedAt: "asc" }],
  });
  if (memberships.length === 0) return null;

  const requested = await readActiveWorkspace();
  const active = memberships.find((m) => m.workspaceId === requested) ?? memberships[0];

  return {
    userId: session.userId,
    sessionId: session.sessionId,
    user: {
      id: active.user.id,
      name: active.user.name,
      email: active.user.email,
      avatarUrl: active.user.avatarUrl,
      timezone: active.user.timezone,
    },
    workspaceId: active.workspaceId,
    workspace: {
      id: active.workspace.id,
      name: active.workspace.name,
      slug: active.workspace.slug,
      currency: active.workspace.currency,
      timezone: active.workspace.timezone,
      logoUrl: active.workspace.logoUrl,
      autopilotMode: active.workspace.autopilotMode,
      onboardedAt: active.workspace.onboardedAt,
    },
    memberId: active.id,
    roleKey: active.role.key,
    roleName: active.role.name,
    permissions: active.role.permissions,
    workspaces: memberships.map((m) => ({
      id: m.workspaceId,
      name: m.workspace.name,
      slug: m.workspace.slug,
      roleName: m.role.name,
    })),
  };
});

/** Server-component guard: redirects unauthenticated callers to the login page. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function assertPermission(ctx: AuthContext, permission: Permission): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenError(permission);
}

/**
 * Reps only see their own leads unless granted LEADS_VIEW_ALL. Returned as a
 * Prisma `where` fragment so the restriction lands in SQL, never in the UI.
 */
export function leadVisibilityFilter(ctx: AuthContext): { ownerId?: string } {
  if (ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL)) return {};
  return { ownerId: ctx.userId };
}
