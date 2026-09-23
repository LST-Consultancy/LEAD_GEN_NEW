import "server-only";
import { randomUUID } from "node:crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { getRedis } from "@/lib/queue/connection";
import { db } from "@/lib/db";
// Fixed documented vendor hosts only. Arbitrary URLs, redirects and crawler requests are refused.
const HOSTS = new Set(["api.search.brave.com", "boards-api.greenhouse.io", "api.lever.co", "api.hunter.io", "api.adzuna.com", "api.ashbyhq.com", "www.signalhire.com"]);
export function validateProviderUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== "https:" || !HOSTS.has(u.hostname) || u.port || u.username || u.password) throw new Error("Provider destination is not permitted.");
  return u;
}
export async function providerJson(workspaceId: string, provider: string, url: string, headers: Record<string, string> = {}, body?: Record<string, unknown>): Promise<unknown> {
  const u = validateProviderUrl(url);
  const redis = getRedis();
  if (!redis) throw new Error("Provider requests require Redis for shared limits and concurrency.");
  const lockKey = `provider-lock:${workspaceId}:${provider}`; const token = randomUUID();
  if (await redis.set(lockKey, token, "EX", 120, "NX") !== "OK") throw new Error("Another request to this provider is active. Retry shortly.");
  try {
    for (let attempt = 0; attempt < (body ? 1 : 3); attempt++) {
      for (const [windowSeconds, limit] of [[60, 20], [3600, 300], [86400, 1500]]) {
        const result = await rateLimit("write", `provider:${workspaceId}:${provider}:${windowSeconds}`, { windowSeconds, limit });
        if (!result.allowed || result.degraded) throw new Error("Provider request limit reached or shared limiter unavailable. Try later.");
      }
      const request = await db.providerSync.create({ data: { workspaceId, provider, operation: "http_request", state: "RUNNING", requests: 1 } });
      let response: Response;
      try {
        response = await fetch(u, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, redirect: "error", signal: AbortSignal.timeout(15000), cache: "no-store" });
        if (response.ok) {
          const reader = response.body?.getReader(); if (!reader) throw new Error("Empty provider response.");
          let size = 0; const chunks: Uint8Array[] = [];
          while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 5_000_000) { await reader.cancel(); throw new Error("Provider response exceeded the size limit."); } chunks.push(chunk.value); }
          const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          await db.providerSync.update({ where: { id: request.id, workspaceId }, data: { state: "COMPLETED", finishedAt: new Date() } });
          return data;
        }
        await response.body?.cancel();
        await db.providerSync.update({ where: { id: request.id, workspaceId }, data: { state: "FAILED", error: `HTTP ${response.status}`, finishedAt: new Date() } });
      } catch {
        await db.providerSync.update({ where: { id: request.id, workspaceId }, data: { state: "FAILED", error: "Connection, timeout or response validation failure.", finishedAt: new Date() } });
        throw new Error("Provider connection failed, timed out or returned invalid data.");
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt)); continue; }
      throw new Error(`Provider request failed (HTTP ${response.status}). Check connection permissions and quota.`);
    }
    throw new Error("Provider retries exhausted.");
  } finally { await redis.eval('if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end', 1, lockKey, token); }
}
