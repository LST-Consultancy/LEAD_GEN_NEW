import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PROVIDERS } from "@/lib/providers/opportunity-source";

/**
 * One answer per operation to "can this workspace do X right now?".
 *
 * Screens used to share a single static flag meaning "an ingestion source is
 * configured", which was false in code and so contradicted the provider page
 * after Brave, Apify, Hunter and SignalHire were connected. The question is
 * really several: discovery, enrichment and verification each have their own
 * providers, and phrase watching, standalone lookup and external research have
 * no adapter at all. Each state keeps apart what the audit asked to keep apart:
 * adapter built, credentials saved, permission granted, last health check.
 */
export type Operation = "opportunity_discovery" | "contact_enrichment" | "email_verification" | "phrase_watching" | "person_lookup" | "company_research";
export type CapabilityState = "available" | "untested" | "failing" | "not_connected" | "not_built";
export type ProviderReadiness = { id: string; name: string; state: "healthy" | "untested" | "failing" | "disabled" | "missing_permission" | "missing_credentials" };
export type Capability = { operation: Operation; state: CapabilityState; providers: ProviderReadiness[]; detail: string; setupHref: string | null };

const OPERATIONS: Record<Operation, { providers: string[]; needs: ("allowedSearch" | "allowedEnrichment" | "allowedStorage")[]; label: string; whereToUse: string; unbuilt?: string }> = {
  opportunity_discovery: { providers: ["brave", "linkedin_posts", "greenhouse", "lever", "ashby", "adzuna"], needs: ["allowedSearch", "allowedStorage"], label: "Opportunity discovery", whereToUse: "Find Opportunities" },
  contact_enrichment: { providers: ["hunter", "signalhire"], needs: ["allowedEnrichment", "allowedStorage"], label: "Finding people at a company", whereToUse: "Find people on an opportunity" },
  email_verification: { providers: ["hunter"], needs: ["allowedEnrichment", "allowedStorage"], label: "Email verification", whereToUse: "Verify emails on an opportunity" },
  phrase_watching: { providers: [], needs: [], label: "Search-phrase watching", whereToUse: "", unbuilt: "Search phrases are not fetched by any connected provider yet. To watch for new demand, save a watch on Find Opportunities — those run on your connected sources." },
  person_lookup: { providers: [], needs: [], label: "Standalone person lookup", whereToUse: "", unbuilt: "Looking up someone who is not already in this workspace is not built. Find people at a company from one of its opportunities instead." },
  company_research: { providers: [], needs: [], label: "External company research", whereToUse: "", unbuilt: "Research from outside sources (funding, news, hiring) is not built. Opportunity research summarises the evidence already collected." },
};

export async function getCapabilities(ctx: AuthContext): Promise<Record<Operation, Capability>> {
  const rows = await db.providerConnection.findMany({ where: { workspaceId: ctx.workspaceId } });
  const out = {} as Record<Operation, Capability>;
  for (const [operation, spec] of Object.entries(OPERATIONS) as [Operation, (typeof OPERATIONS)[Operation]][]) {
    if (spec.unbuilt) { out[operation] = { operation, state: "not_built", providers: [], detail: spec.unbuilt, setupHref: null }; continue; }
    const providers: ProviderReadiness[] = spec.providers.flatMap((id) => {
      const descriptor = PROVIDERS.find((p) => p.id === id);
      const row = rows.find((r) => r.provider === id);
      if (!descriptor?.implemented || !row) return [];
      const state: ProviderReadiness["state"] = !row.enabled ? "disabled"
        : descriptor.key && !row.encryptedCredentials ? "missing_credentials"
        : spec.needs.some((n) => !row[n]) ? "missing_permission"
        : row.status === "CONNECTED" ? "healthy" : row.status === "ERROR" ? "failing" : "untested";
      return [{ id, name: descriptor.name, state }];
    });
    const usable = providers.filter((p) => ["healthy", "untested", "failing"].includes(p.state));
    const state: CapabilityState = providers.some((p) => p.state === "healthy") ? "available" : usable.some((p) => p.state === "untested") ? "untested" : usable.length ? "failing" : "not_connected";
    const names = (s: ProviderReadiness["state"]) => providers.filter((p) => p.state === s).map((p) => p.name).join(", ");
    const detail = state === "available" ? `${spec.label} runs on ${names("healthy")}. Use it from ${spec.whereToUse}.`
      : state === "untested" ? `${names("untested")} ${usable.length > 1 ? "are" : "is"} connected but not yet tested. Test it in Settings → Providers.`
      : state === "failing" ? `${names("failing")} failed its last test. Check the credentials in Settings → Providers.`
      : `No provider for ${spec.label.toLowerCase()} is connected. Connect one in Settings → Providers.`;
    out[operation] = { operation, state, providers, detail, setupHref: state === "available" ? null : "/settings/providers" };
  }
  return out;
}

export const isUsable = (c: Capability) => c.state === "available" || c.state === "untested";
