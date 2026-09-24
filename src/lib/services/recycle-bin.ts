import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { MutationError, clearDeletedRecord, loadScoped, mutate } from "@/lib/services/mutate";

/**
 * §82 — the recycle bin.
 *
 * `softDelete` indexes every deletion here, so this screen is a real inventory
 * rather than a promise. Two things it must get right:
 *
 *  - **The purge date is shown, not implied.** "Deleted items are kept for a
 *    while" is not something anyone can plan around.
 *  - **Restore is honest about what it can restore.** Some types clear a
 *    `deletedAt` and come back whole; others were hard removals indexed for
 *    the record. Offering one button for both would silently do nothing for
 *    half of them.
 */

/**
 * Types that can genuinely be restored, and the column to clear.
 *
 * A type absent from here is listed in the bin but its restore is refused with
 * a reason — which is the honest outcome, and better than a button that
 * appears to work.
 */
const RESTORABLE: Record<string, { label: string; restore: (id: string) => Promise<void> }> = {
  Lead: {
    label: "Lead",
    restore: async (id) => {
      await db.lead.update({ where: { id }, data: { deletedAt: null } });
    },
  },
  KnowledgeDoc: {
    label: "Knowledge entry",
    restore: async (id) => {
      await db.knowledgeDoc.update({ where: { id }, data: { deletedAt: null } });
    },
  },
  Playbook: {
    label: "Playbook",
    restore: async (id) => {
      // Deliberately comes back inactive. A playbook that reactivated itself on
      // restore would start running against whatever has changed since.
      await db.playbook.update({ where: { id }, data: { deletedAt: null, isActive: false } });
    },
  },
  Competitor: {
    label: "Competitor",
    restore: async (id) => {
      await db.competitor.update({ where: { id }, data: { deletedAt: null } });
    },
  },
  List: {
    label: "List",
    restore: async (id) => {
      await db.list.update({ where: { id }, data: { deletedAt: null } });
    },
  },
  SearchPhrase: {
    label: "Search phrase",
    restore: async (id) => {
      // Returns paused: resuming a watch silently would start spending again.
      await db.searchPhrase.update({
        where: { id },
        data: { deletedAt: null, isActive: false, nextRunAt: null },
      });
    },
  },
  Sequence: {
    label: "Sequence",
    restore: async (id) => {
      await db.sequence.update({ where: { id }, data: { deletedAt: null, isActive: false } });
    },
  },
};

export type BinEntry = {
  id: string;
  objectType: string;
  typeLabel: string;
  objectId: string;
  label: string;
  deletedByLabel: string;
  deletedAt: string;
  purgeAfter: string;
  /** Whether this type can actually be brought back. */
  restorable: boolean;
  /** Why not, when it can't. Null when it can. */
  blockedBecause: string | null;
};

export async function listRecycleBin(ctx: AuthContext): Promise<{
  entries: BinEntry[];
  retentionDays: number;
  restoredCount: number;
}> {
  const [workspace, rows, restoredCount] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { recycleBinDays: true },
    }),
    db.deletedRecord.findMany({
      where: { workspaceId: ctx.workspaceId, restoredAt: null },
      orderBy: { purgeAfter: "asc" },
      take: 200,
    }),
    db.deletedRecord.count({ where: { workspaceId: ctx.workspaceId, restoredAt: { not: null } } }),
  ]);

  return {
    retentionDays: workspace.recycleBinDays,
    restoredCount,
    entries: rows.map((r) => {
      const spec = RESTORABLE[r.objectType];
      return {
        id: r.id,
        objectType: r.objectType,
        typeLabel: spec?.label ?? r.objectType,
        objectId: r.objectId,
        label: r.label,
        deletedByLabel: r.deletedByLabel,
        deletedAt: r.createdAt.toISOString(),
        purgeAfter: r.purgeAfter.toISOString(),
        restorable: Boolean(spec),
        blockedBecause: spec
          ? null
          : `A ${r.objectType} is recorded here for the audit trail, but restoring one isn't built — the row itself was removed rather than marked deleted.`,
      };
    }),
  };
}

export async function restoreFromBin(ctx: AuthContext, entryId: string) {
  const entry = await loadScoped(
    () =>
      db.deletedRecord.findFirst({
        where: { id: entryId, workspaceId: ctx.workspaceId, restoredAt: null },
      }),
    "That deleted item"
  );

  const spec = RESTORABLE[entry.objectType];
  if (!spec) {
    throw new MutationError(
      `${entry.objectType} can't be restored — the row was removed rather than marked deleted, and this entry exists for the audit trail. Nothing was changed.`,
      "not_restorable",
      422
    );
  }

  // Past its purge date the row may genuinely be gone, so say that rather than
  // failing with a foreign-key error from deep inside Prisma.
  if (entry.purgeAfter.getTime() < Date.now()) {
    throw new MutationError(
      `This passed its purge date on ${entry.purgeAfter.toLocaleDateString("en-IN")}, so the data may already have been removed. Nothing was changed.`,
      "already_purged",
      410
    );
  }

  return mutate(ctx, PERMISSIONS.DATA_DELETE, async () => {
    await spec.restore(entry.objectId);
    await clearDeletedRecord(ctx, entry.objectType, entry.objectId);
    return {
      result: { id: entry.id, objectType: entry.objectType, objectId: entry.objectId },
      log: {
        action: "recycle_bin.restored",
        objectType: entry.objectType,
        objectId: entry.objectId,
        before: { deleted: true, purgeAfter: entry.purgeAfter.toISOString() },
        after: { deleted: false },
        activity: {
          kind: "recycle_bin.restored",
          summary: `${spec.label} restored: ${entry.label}`,
        },
      },
    };
  });
}
