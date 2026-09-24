import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate, softDelete } from "./mutate";

/**
 * Competitors are matched against signal text by name and alias, so the
 * aliases are what make tracking work — "Meridian SI" as well as "Meridian
 * Systems Integration". Managed by whoever maintains the knowledge base.
 */
const schema = z.object({
  name: z.string().trim().min(2, "A competitor needs a name.").max(120),
  domain: z.string().trim().toLowerCase().max(200).regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, "Just the domain, like acme.com.").or(z.literal("")).optional(),
  aliases: z.array(z.string().trim().min(2).max(80)).max(20).default([]),
  notes: z.string().trim().max(2000).optional(),
});
export type CompetitorInput = z.input<typeof schema>;

const clean = (i: z.output<typeof schema>) => ({
  name: i.name, domain: i.domain || null, notes: i.notes || null,
  // Deduplicated without case, and never repeating the name itself.
  aliases: [...new Map(i.aliases.filter((a) => a.toLowerCase() !== i.name.toLowerCase()).map((a) => [a.toLowerCase(), a])).values()],
});

async function nameTaken(ctx: AuthContext, name: string, exceptId?: string) {
  return db.competitor.findFirst({ where: { workspaceId: ctx.workspaceId, deletedAt: null, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
}

export async function createCompetitor(ctx: AuthContext, raw: CompetitorInput) {
  const input = clean(schema.parse(raw));
  if (await nameTaken(ctx, input.name)) throw new MutationError(`${input.name} is already tracked.`, "duplicate_name", 409);
  return mutate(ctx, PERMISSIONS.KNOWLEDGE_MANAGE, async () => {
    // A soft-deleted row keeps the unique name, so re-adding restores it.
    const row = await db.competitor.upsert({
      where: { workspaceId_name: { workspaceId: ctx.workspaceId, name: input.name } },
      create: { workspaceId: ctx.workspaceId, ...input },
      update: { ...input, deletedAt: null, isActive: true },
    });
    return { result: toPlain(row), log: { action: "competitor.created", objectType: "Competitor", objectId: row.id, after: input } };
  });
}

export async function updateCompetitor(ctx: AuthContext, id: string, raw: CompetitorInput) {
  const input = clean(schema.parse(raw));
  const before = await loadScoped(() => db.competitor.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }), "That competitor");
  if (await nameTaken(ctx, input.name, id)) throw new MutationError(`${input.name} is already tracked.`, "duplicate_name", 409);
  return mutate(ctx, PERMISSIONS.KNOWLEDGE_MANAGE, async () => {
    const row = await db.competitor.update({ where: { id }, data: input });
    return { result: toPlain(row), log: { action: "competitor.updated", objectType: "Competitor", objectId: id, before: { name: before.name, aliases: before.aliases }, after: { name: row.name, aliases: row.aliases } } };
  });
}

export async function deleteCompetitor(ctx: AuthContext, id: string) {
  const row = await loadScoped(() => db.competitor.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }), "That competitor");
  return mutate(ctx, PERMISSIONS.KNOWLEDGE_MANAGE, async () => {
    await db.competitor.update({ where: { id }, data: { deletedAt: new Date() } });
    await softDelete(ctx, { objectType: "Competitor", objectId: id, label: row.name });
    return { result: { id }, log: { action: "competitor.deleted", objectType: "Competitor", objectId: id, before: { name: row.name } } };
  });
}
