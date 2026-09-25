import "server-only";
import { z } from "zod";
import { providerJson } from "@/lib/providers/http";
import { actorPath } from "@/lib/providers/apify";
import { apifyTokenFor } from "@/lib/providers/apify-discovery";
import { PLATFORMS, platformConfigSchema, type ApifyPlatformId } from "@/lib/opportunities/apify-platforms";

/**
 * A free check for one discovery platform: Apify accepts the token and the Actor exists and is
 * visible to the account. Nothing is run or charged, so it cannot prove a run will succeed.
 */
export async function checkApifyPlatform(workspaceId: string, provider: ApifyPlatformId, rawConfig: unknown) {
  const key = await apifyTokenFor(workspaceId, provider);
  if (!key) return { ok: false, message: "No Apify token is saved for this platform or for LinkedIn posts. Nothing was run or charged." };
  const actorId = platformConfigSchema.parse(rawConfig ?? {}).actor ?? PLATFORMS[provider].actor;
  const auth = { Authorization: `Bearer ${key}` };
  await providerJson(workspaceId, provider, "https://api.apify.com/v2/users/me", auth);
  try {
    const meta = z.object({ data: z.object({ id: z.string(), isDeprecated: z.boolean().optional() }) }).parse(await providerJson(workspaceId, provider, `https://api.apify.com/v2/acts/${actorPath(actorId)}`, auth));
    if (meta.data.isDeprecated) return { ok: false, message: `Apify accepted the token, but ${actorId} is marked deprecated by its author. Nothing was run or charged.` };
  } catch { return { ok: false, message: `Apify accepted the token, but ${actorId} could not be found or is not available to this account. Nothing was run or charged.` }; }
  return { ok: true, message: `Apify accepted the token and ${actorId} is available. Nothing was run or charged by this test; the first search shows what it actually returns.` };
}
