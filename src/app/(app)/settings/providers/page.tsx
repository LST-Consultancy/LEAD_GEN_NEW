import { requireAuth } from "@/lib/auth/context";
import { listOpportunityProviders, getDiscoveryReadiness } from "@/lib/services/opportunity-providers";
import { ProviderSettings } from "@/components/opportunities/provider-settings";
export const metadata = { title: "Lead Sources & APIs" };
export default async function ProvidersPage() {
  const ctx = await requireAuth();
  const [providers, readiness] = await Promise.all([listOpportunityProviders(ctx), getDiscoveryReadiness(ctx)]);
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Lead Sources & APIs</h1><ProviderSettings providers={providers} readiness={readiness} canManage={ctx.permissions.includes("api_keys.manage")} /></div>;
}
