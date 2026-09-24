import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { mutate, MutationError, loadScoped } from "./mutate";
import { PROVIDERS } from "@/lib/providers/opportunity-source";
import { encryptCredential, decryptCredential } from "@/lib/providers/credentials";
import { discoveryProvider, providerConfigSchema } from "@/lib/providers/discovery";
import { getWorkerReadiness } from "@/lib/queue/producer";
import { enrichmentConfigSchema } from "@/lib/enrichment/config";
const ENRICHMENT_PROVIDER = "apify_enrichment";
import { toPlain } from "@/lib/serialize";

export async function listOpportunityProviders(ctx: AuthContext) {
  const rows = await db.providerConnection.findMany({ where: { workspaceId: ctx.workspaceId }, select: { provider: true, enabled: true, status: true, allowedSearch: true, allowedStorage: true, allowedEnrichment: true, allowedExport: true, retentionDays: true, lastTestedAt: true, config: true } });
  return PROVIDERS.map(p => ({ ...p, connection: toPlain(rows.find(r => r.provider === p.id) ?? null) }));
}
const connectionSchema = z.object({ apiKey: z.string().trim().min(1).max(2000).optional(), enabled: z.boolean().default(true), config: z.unknown().default({}), allowedSearch: z.boolean().default(false), allowedStorage: z.boolean().default(false), allowedEnrichment: z.boolean().default(false), allowedExport: z.boolean().default(false), retentionDays: z.number().int().min(1).max(365).default(30) });
export async function connectOpportunityProvider(ctx: AuthContext, provider: string, raw: unknown) {
  assertPermission(ctx, PERMISSIONS.API_KEYS_MANAGE);
  const descriptor = PROVIDERS.find(p => p.id === provider);
  if (!descriptor?.implemented) throw new MutationError(descriptor?.description ?? "Unknown provider.", "capability_unavailable", 422);
  const parsed = connectionSchema.parse(raw);
  // Each provider's settings are validated by its own schema, so one provider's fields are never stripped as another's.
  const input = { ...parsed, config: provider === ENRICHMENT_PROVIDER ? enrichmentConfigSchema.parse(parsed.config ?? {}) : providerConfigSchema.parse(parsed.config ?? {}) };
  if (input.enabled && ["greenhouse", "lever", "ashby"].includes(provider) && !(input.config as { boards: unknown[] }).boards.length) throw new MutationError("Add at least one company job board.", "configuration_required", 422);
  if (input.enabled && provider === "adzuna" && (!(input.config as { appId: string }).appId || !(input.config as { countries: string[] }).countries.length)) throw new MutationError("Adzuna requires an application ID and at least one job market.", "configuration_required", 422);
  const existing = await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider } } });
  const sharedApify = provider === ENRICHMENT_PROVIDER && Boolean((await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: "linkedin_posts" } } }))?.encryptedCredentials);
  if (descriptor.key && !input.apiKey && !existing?.encryptedCredentials && !sharedApify) throw new MutationError(provider === ENRICHMENT_PROVIDER ? "Enter an Apify API token, or save one on the LinkedIn posts connection first." : "Supply the provider API key.", "credentials_required", 422);
  const { apiKey, ...settings } = input;
  return mutate(ctx, PERMISSIONS.API_KEYS_MANAGE, async () => {
    const data = { ...settings, status: "UNTESTED", ...(apiKey ? { encryptedCredentials: encryptCredential(apiKey, ctx.workspaceId, provider) } : {}) };
    const row = await db.providerConnection.upsert({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider } }, create: { workspaceId: ctx.workspaceId, provider, ...data }, update: data });
    return { result: { id: row.id, status: row.status, note: "Connection saved. Test it to check API access. Credentials are never returned." }, log: { action: "provider.connected", objectType: "ProviderConnection", objectId: row.id, after: { provider, enabled: input.enabled } } };
  });
}
export async function testOpportunityProvider(ctx: AuthContext, provider: string) {
  assertPermission(ctx, PERMISSIONS.API_KEYS_MANAGE);
  const row = await loadScoped(() => db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider } } }), "That provider connection");
  return mutate(ctx, PERMISSIONS.API_KEYS_MANAGE, async () => {
    let result;
    try {
      if (provider === "signalhire") { const { signalHireProvider } = await import("@/lib/providers/signalhire"); result = await signalHireProvider(ctx.workspaceId, decryptCredential(row.encryptedCredentials!, ctx.workspaceId, provider)).healthCheck(); }
      else if (provider === ENRICHMENT_PROVIDER) { const { checkEnrichmentAccess } = await import("./enrichment-access"); result = await checkEnrichmentAccess(ctx.workspaceId); }
      else if (provider === "hunter") { const { hunterProvider } = await import("@/lib/providers/hunter"); result = await hunterProvider(ctx.workspaceId, decryptCredential(row.encryptedCredentials!, ctx.workspaceId, provider)).healthCheck(); }
      else result = await discoveryProvider(ctx.workspaceId, provider, providerConfigSchema.parse(row.config), row.encryptedCredentials ? decryptCredential(row.encryptedCredentials, ctx.workspaceId, provider) : undefined).healthCheck();
    } catch { result = { ok: false, message: "Provider test failed. Check credentials, permitted capabilities and quota." }; }
    await db.providerConnection.update({ where: { id: row.id, workspaceId: ctx.workspaceId }, data: { status: result.ok ? "CONNECTED" : "ERROR", lastTestedAt: new Date() } });
    return { result, log: { action: "provider.tested", objectType: "ProviderConnection", objectId: row.id, after: { provider, ok: result.ok } } };
  });
}

export async function getDiscoveryReadiness(ctx: AuthContext) {
  const [queue, recent] = await Promise.all([getWorkerReadiness(), db.providerSync.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { startedAt: "desc" }, take: 12, select: { id: true, provider: true, operation: true, state: true, recordsFound: true, error: true, startedAt: true } })]);
  return { queue, encryptionConfigured: /^[a-f0-9]{64}$/i.test(process.env.PROVIDER_ENCRYPTION_KEY ?? ""), recent: toPlain(recent) };
}
