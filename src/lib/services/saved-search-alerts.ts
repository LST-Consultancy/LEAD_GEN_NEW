import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadFilterSchema } from "@/lib/leads/filter";
import { buildLeadQuery } from "@/lib/leads/params";
import { buildWhere } from "./leads";
import { raiseNotification } from "./notify";

const WINDOW_MS = { REALTIME: 0, DAILY: 86_400_000, WEEKLY: 7 * 86_400_000 } as const;

/**
 * Fires "new leads match your saved search" for leads-surface searches with an
 * alert on. Before this existed the Alert toggle was saved and never read.
 *
 * - Matches are counted as the search's creator sees them, so an alert never
 *   reports a lead its recipient cannot open.
 * - "New" means surfaced after the last alert (or after the search was saved).
 * - A search alerts at most once per its frequency window.
 * - Idempotent: the notification and the new `lastAlertAt` are written in one
 *   transaction, conditional on `lastAlertAt` still being what this run read, so
 *   a redelivered job finds nothing to do.
 */
export async function fireSavedSearchAlerts(workspaceId: string, now = new Date()) {
  const searches = await db.savedSearch.findMany({
    where: { workspaceId, surface: "leads", alertEnabled: true, deletedAt: null, createdById: { not: null } },
  });
  let fired = 0; let skipped = 0;

  for (const s of searches) {
    const last = s.lastAlertAt;
    if (last && now.getTime() - last.getTime() < WINDOW_MS[s.frequency]) continue;

    const parsed = leadFilterSchema.safeParse(s.filterJson);
    if (!parsed.success) { skipped++; continue; }
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId, userId: s.createdById!, deletedAt: null, workspace: { deletedAt: null } },
      include: { user: true, workspace: true, role: true },
    });
    // The person it would alert has left; nobody else asked for this.
    if (!member) { skipped++; continue; }
    const ctx: AuthContext = { userId: member.userId, sessionId: "worker", user: member.user, workspaceId, workspace: member.workspace, memberId: member.id, roleKey: member.role.key, roleName: member.role.name, permissions: member.role.permissions, workspaces: [] };

    const since = last ?? s.createdAt;
    const fresh = await db.lead.count({ where: { AND: [buildWhere(ctx, parsed.data), { surfacedAt: { gt: since } }] } });
    if (fresh === 0) continue;

    const wrote = await db.$transaction(async (tx) => {
      const claimed = await tx.savedSearch.updateMany({ where: { id: s.id, workspaceId, lastAlertAt: last }, data: { lastAlertAt: now } });
      if (claimed.count === 0) return false;
      await raiseNotification({
        data: {
          workspaceId,
          userId: member.userId,
          kind: "LEAD_SIGNAL",
          title: `${fresh} new ${fresh === 1 ? "lead matches" : "leads match"} “${s.name}”`,
          body: `Surfaced since ${last ? "the last alert" : "you saved this search"}.`,
          severity: "info",
          href: `/leads${buildLeadQuery(parsed.data)}`,
        },
      }, tx);
      return true;
    });
    if (wrote) fired++;
  }
  return { fired, skipped };
}
