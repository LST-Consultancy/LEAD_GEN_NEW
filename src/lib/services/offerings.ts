import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError, loadScoped, softDelete } from "./mutate";
import { offeringSchema, offeringToSearch } from "@/lib/opportunities/offering";
import { DISCOVERY_PROVIDERS } from "@/lib/providers/opportunity-source";

const scoped = (ctx: AuthContext, id: string) => loadScoped(() => db.offeringProfile.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null } }), "That offering");
const cleanPlatforms = (p: string[]) => p.filter(x => (DISCOVERY_PROVIDERS as readonly string[]).includes(x));

export async function listOfferings(ctx: AuthContext) {
  const rows = await db.offeringProfile.findMany({ where: { workspaceId: ctx.workspaceId, deletedAt: null }, orderBy: { updatedAt: "desc" } });
  return toPlain(rows.map(r => ({ ...r, preview: offeringToSearch(r) })));
}

export async function createOffering(ctx: AuthContext, raw: unknown) {
  const input = offeringSchema.parse(raw);
  return mutate(ctx, PERMISSIONS.ICP_MANAGE, async () => {
    const row = await db.offeringProfile.create({ data: { ...input, platforms: cleanPlatforms(input.platforms), workspaceId: ctx.workspaceId, createdById: ctx.userId } });
    return { result: toPlain(row), log: { action: "offering.created", objectType: "OfferingProfile", objectId: row.id, after: { name: row.name }, activity: { kind: "offering.created", summary: `Offering “${row.name}” created` } } };
  });
}

export async function updateOffering(ctx: AuthContext, id: string, raw: unknown) {
  z.string().uuid().parse(id);
  const input = offeringSchema.parse(raw);
  const before = await scoped(ctx, id);
  return mutate(ctx, PERMISSIONS.ICP_MANAGE, async () => {
    const row = await db.offeringProfile.update({ where: { id: before.id }, data: { ...input, platforms: cleanPlatforms(input.platforms) } });
    return { result: toPlain(row), log: { action: "offering.updated", objectType: "OfferingProfile", objectId: id, before: { name: before.name, buyerPhrases: before.buyerPhrases, jobTitles: before.jobTitles }, after: { name: row.name, buyerPhrases: row.buyerPhrases, jobTitles: row.jobTitles } } };
  });
}

/** Deleting keeps every search already run from it: they carry their own criteria and routing. */
export async function deleteOffering(ctx: AuthContext, id: string) {
  z.string().uuid().parse(id);
  const row = await scoped(ctx, id);
  return mutate(ctx, PERMISSIONS.ICP_MANAGE, async () => {
    await db.offeringProfile.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    await softDelete(ctx, { objectType: "OfferingProfile", objectId: row.id, label: row.name });
    return { result: { id }, log: { action: "offering.deleted", objectType: "OfferingProfile", objectId: id, before: { name: row.name } } };
  });
}

/** What starting a search from this offering will send, for the search screen to show and prefill. */
export async function offeringSearchPlan(ctx: AuthContext, id: string) {
  assertPermission(ctx, PERMISSIONS.LEADS_EDIT);
  const row = await scoped(ctx, id);
  const plan = offeringToSearch(row);
  const connected = await db.providerConnection.findMany({ where: { workspaceId: ctx.workspaceId, provider: { in: row.platforms.length ? row.platforms : [...DISCOVERY_PROVIDERS] }, enabled: true, allowedSearch: true, allowedStorage: true }, select: { provider: true } });
  if (!connected.length) throw new MutationError(row.platforms.length ? "None of this offering's platforms is connected with search and storage rights. Connect one in Settings → Lead Sources & APIs." : "No discovery source is connected with search and storage rights. Connect one in Settings → Lead Sources & APIs.", "not_connected", 422);
  return toPlain({ ...plan, providers: connected.map(c => c.provider), offering: { id: row.id, name: row.name } });
}
