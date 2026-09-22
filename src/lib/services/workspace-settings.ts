import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { patchSchemaOf } from "@/lib/schema/patch";
import { toPlain } from "@/lib/serialize";
import { mutate } from "@/lib/services/mutate";

/**
 * §78 / §83 — workspace profile and data retention.
 *
 * Retention is the part that matters. `archiveAfterDays` and `recycleBinDays`
 * are not cosmetic: the first decides when a lead leaves the working list, the
 * second decides when deleted data is actually gone and unrecoverable. Both are
 * shown with that consequence spelled out, because a number in a box teaches
 * nobody what it does.
 */

/** GSTIN: 2-digit state, 10-char PAN, entity digit, 'Z', checksum. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const workspaceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  website: z.string().trim().url().max(200).or(z.literal("")).optional(),
  industry: z.string().trim().max(80).or(z.literal("")).optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN, "That doesn't look like a valid 15-character GSTIN.")
    .or(z.literal(""))
    .optional(),
  timezone: z.string().trim().min(3).max(64),
  currency: z.string().trim().length(3).toUpperCase(),
  locale: z.string().trim().min(2).max(10),
  // Bounded so a typo can't set retention to a decade or to zero. Zero would
  // mean "purge immediately", which no one intends to type.
  archiveAfterDays: z.number().int().min(7).max(365),
  recycleBinDays: z.number().int().min(7).max(365),
});

export type WorkspaceInput = z.input<typeof workspaceSchema>;

export async function getWorkspaceSettings(ctx: AuthContext) {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: {
      id: true,
      name: true,
      slug: true,
      website: true,
      industry: true,
      gstin: true,
      country: true,
      currency: true,
      timezone: true,
      locale: true,
      archiveAfterDays: true,
      recycleBinDays: true,
      createdAt: true,
    },
  });

  // Counted so the retention screen can say what the setting actually governs
  // in this workspace rather than in the abstract.
  const [archivedCount, pendingPurge, leadCount] = await Promise.all([
    db.lead.count({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: { not: null } },
    }),
    db.deletedRecord.count({ where: { workspaceId: ctx.workspaceId, restoredAt: null } }),
    db.lead.count({ where: { workspaceId: ctx.workspaceId, deletedAt: null } }),
  ]);

  return toPlain({ workspace, archivedCount, pendingPurge, leadCount });
}

export async function updateWorkspaceSettings(
  ctx: AuthContext,
  raw: Partial<WorkspaceInput>
) {
  const input = patchSchemaOf(workspaceSchema).parse(raw);
  const before = await db.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: {
      name: true,
      website: true,
      industry: true,
      gstin: true,
      timezone: true,
      currency: true,
      locale: true,
      archiveAfterDays: true,
      recycleBinDays: true,
    },
  });

  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    const updated = await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: {
        ...input,
        // An empty string means "cleared", which for these is null rather than
        // an empty value sitting in the column.
        ...(input.website === "" ? { website: null } : {}),
        ...(input.industry === "" ? { industry: null } : {}),
        ...(input.gstin === "" ? { gstin: null } : {}),
      },
      select: {
        name: true,
        website: true,
        industry: true,
        gstin: true,
        timezone: true,
        currency: true,
        locale: true,
        archiveAfterDays: true,
        recycleBinDays: true,
      },
    });

    // Shortening retention brings forward the date existing data is destroyed,
    // which is worth a timeline entry rather than only an audit row.
    const retentionChanged =
      before.recycleBinDays !== updated.recycleBinDays ||
      before.archiveAfterDays !== updated.archiveAfterDays;

    return {
      result: toPlain(updated),
      log: {
        action: "workspace.updated",
        objectType: "Workspace",
        objectId: ctx.workspaceId,
        before,
        after: updated,
        activity: retentionChanged
          ? {
              kind: "workspace.updated",
              summary: `Retention changed — archive after ${updated.archiveAfterDays} days, purge ${updated.recycleBinDays} days after deletion`,
            }
          : undefined,
      },
    };
  });
}
