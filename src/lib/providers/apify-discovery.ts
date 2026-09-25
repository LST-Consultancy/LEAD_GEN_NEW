import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { decryptCredential } from "./credentials";
import { findStartedRun, getRun, readDataset, stableJson, startRun, waitForRun } from "./apify";
import { PartialDiscoveryError } from "./opportunity-source";
import { PageFetchError } from "@/lib/opportunities/linkedin-run";
import type { SearchCriteria } from "@/lib/opportunities/query-parser";
import type { Routing } from "@/lib/opportunities/offering";
import type { SourceDocument } from "@/lib/opportunities/extractor";
import { mapGooglePage, mapPlace, PLATFORMS, platformConfigSchema, withinWindow, type ApifyPlatformId, type Place } from "@/lib/opportunities/apify-platforms";

const RUN_TIMEOUT_S = 300;

/**
 * The Apify token for a platform: its own connection's, else the one saved for LinkedIn posts or
 * Apify enrichment — the same Apify account. Null when none is saved.
 */
export async function apifyTokenFor(workspaceId: string, provider: string) {
  const rows = await db.providerConnection.findMany({ where: { workspaceId, provider: { in: [provider, "linkedin_posts", "apify_enrichment"] } } });
  for (const p of [provider, "linkedin_posts", "apify_enrichment"]) {
    const r = rows.find(x => x.provider === p);
    if (r?.encryptedCredentials) return decryptCredential(r.encryptedCredentials, workspaceId, p);
  }
  return null;
}

export type PlatformOutcome = { documents: SourceDocument[]; places: Place[]; returned: number; outsideWindow: number; unreadable: number; repeated: number; usageUsd: number; estimatedUsd: number; runs: number; notes: string[] };

/**
 * One platform's part of a discovery search. Each planned Actor run is recorded in the ApifyRun
 * ledger before it is waited on, keyed by search, platform and query, so a redelivered or resumed
 * search reads the run it already paid for instead of starting another. The per-search spending
 * cap is passed to Apify as the run's charge limit; a query whose estimate would exceed what is
 * left is not started, and the outcome says so.
 */
export async function searchApifyPlatform(input: { workspaceId: string; searchId: string; provider: ApifyPlatformId; rawConfig: unknown; criteria: SearchCriteria; key: string; routing?: Routing; shouldCancel?: () => Promise<boolean> }): Promise<PlatformOutcome> {
  const { workspaceId, searchId, provider, criteria, key } = input;
  const platform = PLATFORMS[provider];
  const config = platformConfigSchema.parse(input.rawConfig ?? {});
  const actorId = config.actor ?? platform.actor;
  const ctx = { criteria, config, routing: input.routing };
  const plan = platform.plan(ctx);
  const out: PlatformOutcome = { documents: [], places: [], returned: 0, outsideWindow: 0, unreadable: 0, repeated: 0, usageUsd: 0, estimatedUsd: 0, runs: 0, notes: [] };
  if (!plan.length) {
    out.notes.push(provider === "apify_google_maps" ? "Google Maps needs business categories and a location: set them on the connection or add an industry and location to the search." : provider === "apify_websites" ? "No website pages are configured on this connection." : "Nothing in this search can be turned into a query for this platform.");
    return out;
  }
  const seen = new Set<string>();
  try {
    for (const [i, run] of plan.entries()) {
      if (input.shouldCancel && await input.shouldCancel()) { out.notes.push("Cancelled before every query ran."); break; }
      const stageKey = `discovery:${searchId}:${provider}:${i}`;
      const inputHash = createHash("sha256").update(stableJson({ actorId, input: run.input })).digest("hex");
      let row = await db.apifyRun.findFirst({ where: { workspaceId, enrichmentRunId: null, stageKey } });
      let items: unknown[];
      if (row?.status === "SUCCEEDED" && row.datasetId) { items = await readDataset(provider, workspaceId, key, row.datasetId, run.maxItems); out.usageUsd += row.usageUsd ?? row.estimatedUsd; }
      else {
        let view = row?.runId ? await getRun(provider, workspaceId, key, row.runId) : row ? await findStartedRun(provider, workspaceId, key, actorId, run.input, row.startedAt.toISOString()) : null;
        if (!view) {
          const remaining = config.maxUsdPerSearch - out.usageUsd;
          if (run.estimateUsd > remaining) { out.notes.push(`“${run.label}” was not run: it is estimated at $${run.estimateUsd.toFixed(3)} and $${Math.max(0, remaining).toFixed(3)} of this platform's $${config.maxUsdPerSearch.toFixed(2)} per-search limit is left.`); continue; }
          row = row ?? await db.apifyRun.create({ data: { workspaceId, stageKey, actorId, inputHash, input: run.input as Prisma.InputJsonValue, estimatedUsd: run.estimateUsd } });
          view = await startRun(provider, workspaceId, key, actorId, run.input, { timeoutS: RUN_TIMEOUT_S, maxItems: run.maxItems, maxTotalChargeUsd: Math.max(0.01, remaining) });
        }
        await db.apifyRun.update({ where: { id: row!.id }, data: { runId: view.id, datasetId: view.defaultDatasetId, status: view.status } });
        view = await waitForRun(provider, workspaceId, key, view, { budgetMs: RUN_TIMEOUT_S * 1000 + 30_000, shouldCancel: input.shouldCancel });
        items = await readDataset(provider, workspaceId, key, view.defaultDatasetId, run.maxItems);
        const usage = view.usageTotalUsd ?? null;
        await db.apifyRun.update({ where: { id: row!.id }, data: { status: view.status === "SUCCEEDED" ? "SUCCEEDED" : view.status, itemCount: items.length, usageUsd: usage, finishedAt: new Date() } });
        out.usageUsd += usage ?? run.estimateUsd;
        if (view.status === "FAILED" && !items.length) { out.notes.push(`The ${platform.name} Actor failed on “${run.label}” without returning results.`); continue; }
      }
      out.runs++; out.estimatedUsd += run.estimateUsd;
      for (const item of items) {
        if (provider === "apify_google_maps") { out.returned++; const p = mapPlace(item); if (p) out.places.push(p); else out.unreadable++; continue; }
        // Google returns one item per results page; each organic result on it counts as one returned.
        const docs = provider === "apify_google_search" ? mapGooglePage(item) : [platform.map(item, { ...ctx, query: run.label })].filter((d): d is SourceDocument => Boolean(d));
        out.returned += provider === "apify_google_search" ? docs.length : 1;
        if (!docs.length && provider !== "apify_google_search") { out.unreadable++; continue; }
        for (const d of docs) {
          // The platform's own filter is never narrower than the window; this drops what it let through beyond it.
          if (!withinWindow(d.postedAt, criteria.dateRange.days)) { out.outsideWindow++; continue; }
          if (seen.has(d.externalId)) { out.repeated++; continue; }
          seen.add(d.externalId); out.documents.push(d);
        }
      }
    }
  } catch (error) {
    const message = error instanceof PageFetchError ? error.message : error instanceof Error ? error.message : `${platform.name} discovery failed.`;
    throw Object.assign(new PartialDiscoveryError(message, out.documents), { outcome: out });
  }
  return out;
}
