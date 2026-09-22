import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate, softDelete, touchLead } from "@/lib/services/mutate";

export const createNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(5000),
    leadId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    isPinned: z.boolean().optional(),
  })
  .refine((v) => v.leadId || v.companyId || v.dealId, {
    message: "A note must be attached to a lead, company or deal.",
  });

export async function createNote(
  ctx: AuthContext,
  raw: z.infer<typeof createNoteSchema>
) {
  // Validated here, not just in the route: this service is also reachable from
  // agents and the MCP layer, and the parent-required rule has to hold there too.
  const input = createNoteSchema.parse(raw);

  // Every parent is verified against the tenant before the note is written, so
  // a note can never be attached to someone else's record.
  if (input.leadId) {
    await loadScoped(
      () =>
        db.lead.findFirst({
          where: {
            id: input.leadId,
            workspaceId: ctx.workspaceId,
            deletedAt: null,
            ...leadVisibilityFilter(ctx),
          },
        }),
      "That lead"
    );
  }
  if (input.companyId) {
    await loadScoped(
      () =>
        db.company.findFirst({
          where: { id: input.companyId, workspaceId: ctx.workspaceId, deletedAt: null },
        }),
      "That company"
    );
  }
  if (input.dealId) {
    await loadScoped(
      () =>
        db.deal.findFirst({
          where: { id: input.dealId, workspaceId: ctx.workspaceId, deletedAt: null },
        }),
      "That deal"
    );
  }

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const note = await db.note.create({
      data: {
        workspaceId: ctx.workspaceId,
        body: input.body,
        authorId: ctx.userId,
        leadId: input.leadId ?? null,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
        isPinned: input.isPinned ?? false,
      },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });

    if (input.leadId) await touchLead(input.leadId);

    return {
      result: toPlain({
        id: note.id,
        body: note.body,
        isPinned: note.isPinned,
        author: note.author,
        createdAt: note.createdAt,
      }),
      log: {
        action: "note.created",
        objectType: "Note",
        objectId: note.id,
        after: { body: note.body.slice(0, 200) },
        activity: {
          kind: "note.added",
          summary: `Note added: ${note.body.slice(0, 80)}${note.body.length > 80 ? "…" : ""}`,
          leadId: input.leadId,
          companyId: input.companyId,
          dealId: input.dealId,
        },
      },
    };
  });
}

export const updateNoteSchema = z.object({
  body: z.string().trim().min(1).max(5000).optional(),
  isPinned: z.boolean().optional(),
});

export async function updateNote(
  ctx: AuthContext,
  noteId: string,
  raw: z.infer<typeof updateNoteSchema>
) {
  const input = updateNoteSchema.parse(raw);
  const note = await loadScoped(
    () =>
      db.note.findFirst({
        where: { id: noteId, workspaceId: ctx.workspaceId, deletedAt: null },
      }),
    "That note"
  );

  // Editing someone else's words is a different thing from editing your own.
  if (note.authorId !== ctx.userId && !ctx.permissions.includes(PERMISSIONS.WORKSPACE_MANAGE)) {
    throw new MutationError("You can only edit your own notes.", "forbidden", 403);
  }

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const updated = await db.note.update({
      where: { id: noteId },
      data: input,
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return {
      result: toPlain({
        id: updated.id,
        body: updated.body,
        isPinned: updated.isPinned,
        author: updated.author,
        createdAt: updated.createdAt,
      }),
      log: {
        action: "note.updated",
        objectType: "Note",
        objectId: noteId,
        before: { body: note.body.slice(0, 200), isPinned: note.isPinned },
        after: { body: updated.body.slice(0, 200), isPinned: updated.isPinned },
      },
    };
  });
}

export async function deleteNote(ctx: AuthContext, noteId: string) {
  const note = await loadScoped(
    () =>
      db.note.findFirst({
        where: { id: noteId, workspaceId: ctx.workspaceId, deletedAt: null },
      }),
    "That note"
  );

  if (note.authorId !== ctx.userId && !ctx.permissions.includes(PERMISSIONS.DATA_DELETE)) {
    throw new MutationError("You can only delete your own notes.", "forbidden", 403);
  }

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    await db.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
    await softDelete(ctx, {
      objectType: "Note",
      objectId: noteId,
      label: note.body.slice(0, 80),
    });
    return {
      result: { id: noteId, deleted: true },
      log: {
        action: "note.deleted",
        objectType: "Note",
        objectId: noteId,
        before: { body: note.body.slice(0, 200) },
      },
    };
  });
}
