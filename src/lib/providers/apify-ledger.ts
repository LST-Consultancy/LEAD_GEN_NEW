import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { findStartedRun, getRun, readDataset, stableJson, startRun, waitForRun } from "./apify";
import { PageFetchError } from "@/lib/opportunities/linkedin-run";

/**
 * One chargeable Actor run outside an enrichment run, recorded in the ApifyRun ledger under
 * `stageKey` before it is waited on. A second call with the same key reads the recorded run's
 * dataset instead of paying again; a start whose reply was lost is found by its stored input.
 */
export async function runLedgeredActor(o: { workspaceId: string; provider: string; key: string; stageKey: string; actorId: string; input: Record<string, unknown>; maxItems: number; estimateUsd: number; maxUsd: number; timeoutS?: number }) {
  const timeoutS = o.timeoutS ?? 240;
  let row = await db.apifyRun.findFirst({ where: { workspaceId: o.workspaceId, enrichmentRunId: null, stageKey: o.stageKey } });
  if (row?.status === "SUCCEEDED" && row.datasetId) return { items: await readDataset(o.provider, o.workspaceId, o.key, row.datasetId, o.maxItems), usageUsd: row.usageUsd ?? row.estimatedUsd, reused: true };
  let view = row?.runId ? await getRun(o.provider, o.workspaceId, o.key, row.runId) : row ? await findStartedRun(o.provider, o.workspaceId, o.key, o.actorId, o.input, row.startedAt.toISOString()) : null;
  if (!view) {
    if (o.estimateUsd > o.maxUsd) throw new PageFetchError(`Not run: estimated at $${o.estimateUsd.toFixed(3)}, above the $${o.maxUsd.toFixed(2)} limit.`, "fatal");
    row = row ?? await db.apifyRun.create({ data: { workspaceId: o.workspaceId, stageKey: o.stageKey, actorId: o.actorId, inputHash: createHash("sha256").update(stableJson({ actorId: o.actorId, input: o.input })).digest("hex"), input: o.input as Prisma.InputJsonValue, estimatedUsd: o.estimateUsd } });
    view = await startRun(o.provider, o.workspaceId, o.key, o.actorId, o.input, { timeoutS, maxItems: o.maxItems, maxTotalChargeUsd: Math.max(0.01, o.maxUsd) });
  }
  await db.apifyRun.update({ where: { id: row!.id }, data: { runId: view.id, datasetId: view.defaultDatasetId, status: view.status } });
  view = await waitForRun(o.provider, o.workspaceId, o.key, view, { budgetMs: timeoutS * 1000 + 30_000 });
  const items = await readDataset(o.provider, o.workspaceId, o.key, view.defaultDatasetId, o.maxItems);
  await db.apifyRun.update({ where: { id: row!.id }, data: { status: view.status === "SUCCEEDED" ? "SUCCEEDED" : view.status, itemCount: items.length, usageUsd: view.usageTotalUsd ?? null, finishedAt: new Date() } });
  if (view.status === "FAILED" && !items.length) throw new PageFetchError(`The Apify Actor ${o.actorId} failed without returning results.`, "retryable");
  return { items, usageUsd: view.usageTotalUsd ?? o.estimateUsd, reused: false };
}
