import { afterAll, describe, expect, it, vi } from "vitest";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { connectOpportunityProvider } from "@/lib/services/opportunity-providers";
import { getCapabilities, isUsable } from "@/lib/services/capabilities";
import { getTrustSummary } from "@/lib/services/trust";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });
async function workspace() {
  vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
  const w = await makeWorkspace("CapabilityFixture");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  return w;
}
const setStatus = (workspaceId: string, provider: string, status: string) => db.providerConnection.update({ where: { workspaceId_provider: { workspaceId, provider } }, data: { status } });

describe("provider capability registry", () => {
  it("reports nothing connected for a new workspace, and unbuilt operations as unbuilt", async () => {
    const w = await workspace();
    const caps = await getCapabilities(w.ctx);
    expect(caps.opportunity_discovery.state).toBe("not_connected");
    expect(caps.phrase_watching.state).toBe("not_built");
    expect(caps.person_lookup.state).toBe("not_built");
    // Built since the Apify enrichment work: unconnected, not unbuilt.
    expect(caps.company_research.state).toBe("not_connected");
  });

  it("distinguishes tested, untested, failing, disabled and unlicensed connections", async () => {
    const w = await workspace();
    await connectOpportunityProvider(w.ctx, "brave", { apiKey: "k", config: {}, allowedSearch: true, allowedStorage: true });
    await connectOpportunityProvider(w.ctx, "linkedin_posts", { apiKey: "k", config: {}, allowedSearch: true, allowedStorage: true });
    await connectOpportunityProvider(w.ctx, "hunter", { apiKey: "k", config: {}, allowedSearch: true, allowedStorage: true, allowedEnrichment: true });
    await connectOpportunityProvider(w.ctx, "signalhire", { apiKey: "k", config: {}, allowedSearch: true, allowedStorage: true, allowedEnrichment: false });
    await setStatus(w.workspace.id, "brave", "CONNECTED");
    await setStatus(w.workspace.id, "hunter", "ERROR");

    const caps = await getCapabilities(w.ctx);
    expect(caps.opportunity_discovery.state).toBe("available");
    expect(caps.opportunity_discovery.providers).toEqual([
      { id: "brave", name: "Brave Public Web", state: "healthy" },
      { id: "linkedin_posts", name: "LinkedIn posts (via Apify)", state: "untested" },
    ]);
    expect(caps.opportunity_discovery.detail).toMatch(/runs on Brave Public Web/);
    expect(caps.contact_enrichment.state).toBe("failing");
    expect(caps.contact_enrichment.providers.find((p) => p.id === "signalhire")?.state).toBe("missing_permission");
    expect(caps.email_verification.state).toBe("failing");

    await db.providerConnection.update({ where: { workspaceId_provider: { workspaceId: w.workspace.id, provider: "brave" } }, data: { enabled: false } });
    const after = await getCapabilities(w.ctx);
    expect(after.opportunity_discovery.state).toBe("untested");
    expect(isUsable(after.opportunity_discovery)).toBe(true);
  });

  it("makes the Trust page agree with the provider registry", async () => {
    const w = await workspace();
    await connectOpportunityProvider(w.ctx, "brave", { apiKey: "k", config: {}, allowedSearch: true, allowedStorage: true });
    await setStatus(w.workspace.id, "brave", "CONNECTED");
    const trust = await getTrustSummary(w.ctx);
    const discovery = trust.services.find((s) => s.name === "Lead discovery");
    expect(discovery).toMatchObject({ connected: true });
    expect(discovery?.detail).toMatch(/Brave Public Web/);
  });
});
