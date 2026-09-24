import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";

/** Current members, for owner and assignee pickers. Names only — no emails or roles leak to a picker. */
export async function listMembers(ctx: AuthContext) {
  const rows = await db.workspaceMember.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, user: { deletedAt: null } },
    select: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((r) => ({ id: r.user.id, name: r.user.name, avatarUrl: r.user.avatarUrl, isYou: r.user.id === ctx.userId }));
}
