import "server-only";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";

/**
 * §81 — archived leads.
 *
 * Archiving is not deleting. An archived lead keeps its score, its history and
 * its origin; it is out of the working list, not out of the record. So this
 * screen is a separate view rather than a filter toggle buried in Leads — the
 * distinction only matters if it is visible.
 *
 * Deliberately separate from `listLeads`: that function's `includeArchived`
 * widens the set to *both*, which is the wrong question here.
 */

export type ArchivedLead = {
  id: string;
  name: string;
  companyName: string;
  score: number;
  tier: string;
  status: string;
  archivedAt: string;
  lastActivityAt: string | null;
  surfacedReason: string;
  /** Set when the lead was discarded with a reason rather than simply archived. */
  discardReason: string | null;
};

export async function listArchivedLeads(
  ctx: AuthContext,
  limit = 100
): Promise<{ leads: ArchivedLead[]; total: number; autoArchiveAfterDays: number }> {
  const where = {
    workspaceId: ctx.workspaceId,
    deletedAt: null,
    archivedAt: { not: null },
    ...leadVisibilityFilter(ctx),
  };

  const [rows, total, workspace] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { archivedAt: "desc" },
      take: limit,
      select: {
        id: true,
        tier: true,
        status: true,
        archivedAt: true,
        lastActivityAt: true,
        surfacedReason: true,
        discardReason: true,
        person: { select: { fullName: true } },
        company: { select: { name: true } },
        score: { select: { displayScore: true, overriddenScore: true } },
      },
    }),
    db.lead.count({ where }),
    db.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { archiveAfterDays: true },
    }),
  ]);

  return {
    total,
    autoArchiveAfterDays: workspace.archiveAfterDays,
    leads: rows.map((l) => ({
      id: l.id,
      name: l.person.fullName,
      companyName: l.company.name,
      score: Number(l.score?.overriddenScore ?? l.score?.displayScore ?? 0),
      tier: l.tier,
      status: l.status,
      // Non-null by the `where`, but narrowed here rather than asserted.
      archivedAt: (l.archivedAt ?? new Date()).toISOString(),
      lastActivityAt: l.lastActivityAt?.toISOString() ?? null,
      surfacedReason: l.surfacedReason,
      discardReason: l.discardReason,
    })),
  };
}
