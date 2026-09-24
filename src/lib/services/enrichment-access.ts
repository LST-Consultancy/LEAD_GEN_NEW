import "server-only";
import { z } from "zod";
import { providerJson } from "@/lib/providers/http";
import { actorPath } from "@/lib/providers/apify";
import { enrichmentConnection, ENRICHMENT_PROVIDER } from "./enrichment-runner";

/**
 * A free connection check: Apify's account endpoint confirms the token, and each configured Actor's
 * metadata confirms it exists and is visible to the account. Nothing is run or charged. It cannot
 * prove a paid Actor will run — a plan's spending limit is only discovered by running it.
 */
export async function checkEnrichmentAccess(workspaceId: string) {
  const conn = await enrichmentConnection(workspaceId);
  if ("missing" in conn) return { ok: false, message: conn.missing };
  const auth = { Authorization: `Bearer ${conn.key}` };
  await providerJson(workspaceId, ENRICHMENT_PROVIDER, "https://api.apify.com/v2/users/me", auth);
  const problems: string[] = [];
  for (const [role, actorId] of Object.entries(conn.config.actors)) {
    try {
      const meta = z.object({ data: z.object({ id: z.string(), isDeprecated: z.boolean().optional() }) }).parse(await providerJson(workspaceId, ENRICHMENT_PROVIDER, `https://api.apify.com/v2/acts/${actorPath(actorId)}`, auth));
      if (meta.data.isDeprecated) problems.push(`${role} Actor ${actorId} is marked deprecated by its author`);
    } catch { problems.push(`${role} Actor ${actorId} could not be found or is not available to this account`); }
  }
  if (problems.length) return { ok: false, message: `Apify accepted the token, but: ${problems.join("; ")}. Fix the Actor reference in the Apify enrichment settings. Nothing was run or charged.` };
  return { ok: true, message: `Apify accepted the token and all ${Object.keys(conn.config.actors).length} Actors are available. Nothing was run or charged by this test.` };
}
