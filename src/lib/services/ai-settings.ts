import "server-only";

import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { activeProvider, isConfigured, MODEL_ROUTING, FEATURE_TIER } from "@/lib/ai/provider";
import { allRoutedFeatures, estimateCostInr, isPriced } from "@/lib/ai/complete";

/**
 * What the AI settings screen is allowed to know.
 *
 * Deliberately **no key material** crosses this boundary — not the value, not a
 * masked prefix, not a length. A screen that shows `sk-ant-…a1b2` invites
 * someone to read a key off a shared screen, and it answers a question nobody
 * has: the only thing worth knowing is whether the provider answers.
 */
export type ProviderStatus = {
  provider: string;
  configured: boolean;
  /** Where the key is set, so a person knows what to change. */
  source: string;
  /** The adapters that exist in this build, regardless of configuration. */
  adaptersBuilt: string[];
};

export type FeatureRoute = {
  feature: string;
  tier: string;
  model: string;
  wired: boolean;
  priced: boolean;
};

export type UsageRow = {
  feature: string;
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  costInr: number;
  /** Null rather than 0 when there were no successful calls to average over. */
  avgLatencyMs: number | null;
};

export type AiSettings = {
  status: ProviderStatus;
  routes: FeatureRoute[];
  usage: {
    days: number;
    rows: UsageRow[];
    totalCostInr: number;
    totalCalls: number;
    /**
     * Costs are estimated from published list prices. Stated on the screen
     * beside every figure, because a number that looks billed but isn't is
     * worse than one labelled approximate.
     */
    estimated: true;
  };
  recentFailures: {
    feature: string;
    model: string;
    errorCode: string | null;
    latencyMs: number;
    /** ISO string: a Date must not cross the service boundary. */
    at: string;
  }[];
};

const WINDOW_DAYS = 30;

export async function getAiSettings(ctx: AuthContext): Promise<AiSettings> {
  const provider = activeProvider();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [grouped, latencies, failures] = await Promise.all([
    db.aIRequestLog.groupBy({
      by: ["feature"],
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostInr: true },
    }),
    // Averaged over successful calls only: a call that failed in 700ms because
    // the provider rejected the request says nothing about how fast it is.
    db.aIRequestLog.groupBy({
      by: ["feature"],
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: since }, success: true },
      _avg: { latencyMs: true },
      _count: { _all: true },
    }),
    db.aIRequestLog.findMany({
      where: { workspaceId: ctx.workspaceId, success: false, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { feature: true, model: true, errorCode: true, latencyMs: true, createdAt: true },
    }),
  ]);

  const failureCounts = new Map<string, number>();
  for (const g of grouped) {
    const ok = latencies.find((l) => l.feature === g.feature)?._count._all ?? 0;
    failureCounts.set(g.feature, g._count._all - ok);
  }

  const rows: UsageRow[] = grouped
    .map((g) => {
      const success = latencies.find((l) => l.feature === g.feature);
      return {
        feature: g.feature,
        calls: g._count._all,
        failures: failureCounts.get(g.feature) ?? 0,
        inputTokens: g._sum.inputTokens ?? 0,
        outputTokens: g._sum.outputTokens ?? 0,
        costInr: Number(g._sum.estimatedCostInr ?? 0),
        avgLatencyMs: success?._avg.latencyMs != null ? Math.round(success._avg.latencyMs) : null,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  const wired = allRoutedFeatures();
  const routes: FeatureRoute[] = wired
    .map((f) => ({
      feature: f.feature,
      tier: FEATURE_TIER[f.feature] ?? "fast",
      model: f.model,
      wired: f.wired,
      priced: isPriced(f.model),
    }))
    .sort((a, b) => Number(b.wired) - Number(a.wired) || a.feature.localeCompare(b.feature));

  return {
    status: {
      provider,
      configured: isConfigured(provider),
      source: `${provider.toUpperCase()}_API_KEY in the server environment`,
      // Only one adapter is written; naming the others as routable but unbuilt
      // is the difference between a roadmap and a lie.
      adaptersBuilt: ["anthropic"],
    },
    routes,
    usage: {
      days: WINDOW_DAYS,
      rows,
      totalCostInr: rows.reduce((sum, r) => sum + r.costInr, 0),
      totalCalls: rows.reduce((sum, r) => sum + r.calls, 0),
      estimated: true,
    },
    recentFailures: failures.map((f) => ({
      feature: f.feature,
      model: f.model,
      errorCode: f.errorCode,
      latencyMs: f.latencyMs,
      at: f.createdAt.toISOString(),
    })),
  };
}

/**
 * What one more call of a given size would cost, for the screen's own worked
 * example. Exported so the number on screen comes from the same function that
 * prices a real call rather than from arithmetic typed into JSX.
 */
export function priceExample(model: string, inputTokens: number, outputTokens: number): number {
  return estimateCostInr(model, inputTokens, outputTokens);
}

/** The tier table, for the screen that explains why a feature uses the model it uses. */
export function tierModels(): { tier: string; model: string }[] {
  const provider = activeProvider();
  return Object.entries(MODEL_ROUTING[provider]).map(([tier, model]) => ({ tier, model }));
}
