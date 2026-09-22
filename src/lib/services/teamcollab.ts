import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { patchSchemaOf } from "@/lib/schema/patch";
import { toPlain } from "@/lib/serialize";
import { loadScoped, mutate } from "@/lib/services/mutate";
import {
  STICKY_COLORS,
  STICKY_KINDS,
  type StickyNote,
} from "@/lib/collab/sticky";

/**
 * §33 — team collaboration.
 *
 * Sticky notes are the shared scratchpad: the things a team says to each other
 * about the work, which do not belong on a lead's timeline because they are
 * not facts about the lead. Deliberately workspace-wide and deliberately
 * unstructured — the moment this needs a workflow it should have become a task.
 */

const stickySchema = z.object({
  kind: z.enum(STICKY_KINDS),
  body: z.string().trim().min(1).max(2000),
  color: z.enum(STICKY_COLORS).default("amber"),
  isPinned: z.boolean().default(false),
  leadId: z.string().uuid().nullable().optional(),
});

export type StickyInput = z.input<typeof stickySchema>;

export async function listStickyNotes(ctx: AuthContext): Promise<StickyNote[]> {
  const notes = await db.stickyNote.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      archivedAt: null,
      // A PERSONAL note is visible only to whoever wrote it. Filtered in SQL,
      // not after the query — a `.filter()` here would be a privacy bug.
      OR: [{ kind: { not: "PERSONAL" } }, { authorId: ctx.userId }],
    },
    orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
    take: 100,
    include: { author: { select: { id: true, name: true } } },
  });

  return notes.map((n) => ({
    id: n.id,
    kind: n.kind,
    body: n.body,
    color: n.color,
    isPinned: n.isPinned,
    authorName: n.author.name,
    isMine: n.authorId === ctx.userId,
    leadId: n.leadId,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  }));
}

export async function createStickyNote(ctx: AuthContext, raw: StickyInput) {
  const input = stickySchema.parse(raw);

  return mutate(ctx, PERMISSIONS.LEADS_VIEW_OWN, async () => {
    const note = await db.stickyNote.create({
      data: {
        workspaceId: ctx.workspaceId,
        authorId: ctx.userId,
        kind: input.kind,
        body: input.body,
        color: input.color,
        isPinned: input.isPinned,
        leadId: input.leadId ?? null,
      },
    });
    return {
      result: toPlain(note),
      log: {
        action: "sticky_note.created",
        objectType: "StickyNote",
        objectId: note.id,
        after: { kind: note.kind, isPinned: note.isPinned },
        // No activity row: a note to your team is not an event on the lead's
        // record, and putting it there would pollute the history with chatter.
      },
    };
  });
}

export async function updateStickyNote(ctx: AuthContext, id: string, raw: Partial<StickyInput>) {
  const input = patchSchemaOf(stickySchema).parse(raw);
  const note = await loadScoped(
    () =>
      db.stickyNote.findFirst({
        where: {
          id,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          // Only the author edits their own note. Anyone could otherwise
          // rewrite a colleague's words under their name.
          authorId: ctx.userId,
        },
      }),
    "That note"
  );

  return mutate(ctx, PERMISSIONS.LEADS_VIEW_OWN, async () => {
    const updated = await db.stickyNote.update({ where: { id }, data: input });
    return {
      result: toPlain(updated),
      log: {
        action: "sticky_note.updated",
        objectType: "StickyNote",
        objectId: id,
        before: { body: note.body.slice(0, 200), isPinned: note.isPinned },
        after: { body: updated.body.slice(0, 200), isPinned: updated.isPinned },
      },
    };
  });
}

export async function deleteStickyNote(ctx: AuthContext, id: string) {
  const note = await loadScoped(
    () =>
      db.stickyNote.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null, authorId: ctx.userId },
      }),
    "That note"
  );

  return mutate(ctx, PERMISSIONS.LEADS_VIEW_OWN, async () => {
    await db.stickyNote.update({ where: { id }, data: { deletedAt: new Date() } });
    return {
      result: { id },
      log: {
        action: "sticky_note.deleted",
        objectType: "StickyNote",
        objectId: id,
        before: { kind: note.kind, body: note.body.slice(0, 200) },
      },
    };
  });
}
