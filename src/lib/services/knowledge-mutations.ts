import "server-only";
import { z } from "zod";
import { patchSchemaOf } from "@/lib/schema/patch";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { loadScoped, mutate, softDelete } from "@/lib/services/mutate";
import { KNOWLEDGE_KINDS, kindLabel } from "@/lib/knowledge/kinds";

const knowledgeSchema = z.object({
  kind: z.enum(KNOWLEDGE_KINDS),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(20).max(20_000),
  // Lower-cased and de-duplicated so `Salesforce` and `salesforce` are one tag;
  // otherwise a retrieval filter silently misses half the base.
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(40))
    .max(12)
    .default([])
    .transform((t) => [...new Set(t.filter(Boolean))]),
  isActive: z.boolean().default(true),
});

export type KnowledgeInput = z.input<typeof knowledgeSchema>;

export async function createKnowledgeDoc(ctx: AuthContext, raw: KnowledgeInput) {
  const input = knowledgeSchema.parse(raw);

  return mutate(ctx, PERMISSIONS.KNOWLEDGE_MANAGE, async () => {
    const doc = await db.knowledgeDoc.create({
      data: { ...input, workspaceId: ctx.workspaceId, createdById: ctx.userId },
    });
    return {
      result: toPlain(doc),
      log: {
        action: "knowledge.created",
        objectType: "KnowledgeDoc",
        objectId: doc.id,
        after: { kind: doc.kind, title: doc.title, isActive: doc.isActive },
        activity: {
          kind: "knowledge.created",
          summary: `${kindLabel(doc.kind)} added: ${doc.title}`,
        },
      },
    };
  });
}

export async function updateKnowledgeDoc(
  ctx: AuthContext,
  id: string,
  raw: Partial<KnowledgeInput>
) {
  // `patchSchemaOf`, not `.partial()` — the latter keeps the defaults, so
  // retiring an entry would also wipe its tags.
  const input = patchSchemaOf(knowledgeSchema).parse(raw);
  const doc = await loadScoped(
    () => db.knowledgeDoc.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That knowledge entry"
  );

  return mutate(ctx, PERMISSIONS.KNOWLEDGE_MANAGE, async () => {
    const updated = await db.knowledgeDoc.update({ where: { id }, data: input });
    return {
      result: toPlain(updated),
      log: {
        action: "knowledge.updated",
        objectType: "KnowledgeDoc",
        objectId: id,
        before: { title: doc.title, isActive: doc.isActive, body: doc.body.slice(0, 500) },
        after: {
          title: updated.title,
          isActive: updated.isActive,
          body: updated.body.slice(0, 500),
        },
        // Retiring an entry changes what every future draft is allowed to
        // claim, so it belongs on the timeline; an edited typo does not.
        activity:
          doc.isActive !== updated.isActive
            ? {
                kind: "knowledge.updated",
                summary: `${updated.title} ${updated.isActive ? "returned to" : "retired from"} the knowledge base`,
              }
            : undefined,
      },
    };
  });
}

export async function deleteKnowledgeDoc(ctx: AuthContext, id: string) {
  const doc = await loadScoped(
    () => db.knowledgeDoc.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }),
    "That knowledge entry"
  );

  return mutate(ctx, PERMISSIONS.KNOWLEDGE_MANAGE, async () => {
    await db.knowledgeDoc.update({ where: { id }, data: { deletedAt: new Date() } });
    await softDelete(ctx, {
      objectType: "KnowledgeDoc",
      objectId: id,
      label: doc.title,
    });
    return {
      result: { id },
      log: {
        action: "knowledge.deleted",
        objectType: "KnowledgeDoc",
        objectId: id,
        before: { kind: doc.kind, title: doc.title },
        activity: {
          kind: "knowledge.deleted",
          summary: `${kindLabel(doc.kind)} removed: ${doc.title}`,
        },
      },
    };
  });
}
