import "server-only";
import { randomUUID } from "node:crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { getRedis } from "@/lib/queue/connection";
import { db } from "@/lib/db";
import { ProviderRequestError, providerErrorCode } from "./provider-errors";
export { ProviderRequestError };
// Fixed documented vendor hosts only. Arbitrary URLs, redirects and crawler requests are refused.
const HOSTS = new Set(["api.search.brave.com", "boards-api.greenhouse.io", "api.lever.co", "api.hunter.io", "api.adzuna.com", "api.ashbyhq.com", "www.signalhire.com", "api.apify.com", "api.apollo.io", "graph.facebook.com", "oauth2.googleapis.com", "www.googleapis.com", "api.openai.com", "gmail.googleapis.com", "graph.microsoft.com", "login.microsoftonline.com", "api.razorpay.com"]);
export function validateProviderUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== "https:" || !HOSTS.has(u.hostname) || u.port || u.username || u.password) throw new Error("Provider destination is not permitted.");
  return u;
}
// Apify's own API allows far more than a search board does, and one LinkedIn page costs a start,
// a poll or two and a dataset read, so the default 20/minute would stall a two-page search.
const APIFY_LIMITS: [number, number][] = [[60, 60], [3600, 1000], [86400, 5000]];
const LIMITS: Record<string, [number, number][]> = Object.fromEntries(["linkedin_posts", "apify_enrichment", "apify_linkedin_jobs", "apify_indeed", "apify_naukri", "apify_google_search", "apify_reddit", "apify_upwork", "apify_google_maps", "apify_websites"].map(p => [p, APIFY_LIMITS]));
const DEFAULT_LIMITS: [number, number][] = [[60, 20], [3600, 300], [86400, 1500]];
export async function providerJson(workspaceId: string, provider: string, url: string, headers: Record<string, string> = {}, body?: Record<string, unknown>, opts: { timeoutMs?: number; form?: boolean; method?: "PATCH" | "DELETE" | "POST"; raw?: { contentType: string; body: string } } = {}): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const u = validateProviderUrl(url);
  const redis = getRedis();
  if (!redis) throw new Error("Provider requests require Redis for shared limits and concurrency.");
  const lockKey = `provider-lock:${workspaceId}:${provider}`; const token = randomUUID();
  if (await redis.set(lockKey, token, "EX", Math.max(120, Math.ceil(timeoutMs / 1000) + 30), "NX") !== "OK") throw new ProviderRequestError("Another request to this provider is active. Retry shortly.", "busy");
  try {
    let providerCode: string | null = null;
    // Only reads are retried: a POST may be a paid call, and the provider may already have charged it.
    const attempts = body || opts.raw || opts.method ? 1 : 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      for (const [windowSeconds, limit] of LIMITS[provider] ?? DEFAULT_LIMITS) {
        const result = await rateLimit("write", `provider:${workspaceId}:${provider}:${windowSeconds}`, { windowSeconds, limit });
        if (!result.allowed || result.degraded) throw new ProviderRequestError("Provider request limit reached or shared limiter unavailable. Try later.", "rate_limited", null, result.degraded ? null : windowSeconds);
      }
      const request = await db.providerSync.create({ data: { workspaceId, provider, operation: "http_request", state: "RUNNING", requests: 1 } });
      let response: Response;
      try {
        const encoded = opts.raw ? opts.raw.body : body ? (opts.form ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString() : JSON.stringify(body)) : undefined;
        const contentType = opts.raw ? opts.raw.contentType : body ? (opts.form ? "application/x-www-form-urlencoded" : "application/json") : null;
        response = await fetch(u, { method: opts.method ?? (body || opts.raw ? "POST" : "GET"), body: encoded, headers: { Accept: "application/json", ...(contentType ? { "Content-Type": contentType } : {}), ...headers }, redirect: "error", signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
        if (response.ok) {
          if (response.status === 204) { await db.providerSync.update({ where: { id: request.id, workspaceId }, data: { state: "COMPLETED", finishedAt: new Date() } }); return {}; }
          const reader = response.body?.getReader(); if (!reader) throw new Error("Empty provider response.");
          let size = 0; const chunks: Uint8Array[] = [];
          while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 5_000_000) { await reader.cancel(); throw new Error("Provider response exceeded the size limit."); } chunks.push(chunk.value); }
          const text = Buffer.concat(chunks).toString("utf8");
          // A 204 (a deleted calendar event, a revoked token) has no body to parse.
          const data: unknown = text.trim() ? JSON.parse(text) : {};
          await db.providerSync.update({ where: { id: request.id, workspaceId }, data: { state: "COMPLETED", finishedAt: new Date() } });
          return data;
        }
        // Only the provider's error identifier is kept, so a 403 for "rate limit" and one for "not on
        // your plan" can be told apart without storing a message that might echo the request.
        const errorBody = await response.text().catch(() => "");
        providerCode = providerErrorCode(errorBody.slice(0, 4000));
        await db.providerSync.update({ where: { id: request.id, workspaceId }, data: { state: "FAILED", error: `HTTP ${response.status}${providerCode ? ` (${providerCode})` : ""}`, finishedAt: new Date() } });
      } catch {
        await db.providerSync.update({ where: { id: request.id, workspaceId }, data: { state: "FAILED", error: "Connection, timeout or response validation failure.", finishedAt: new Date() } });
        throw new ProviderRequestError("Provider connection failed, timed out or returned invalid data.", "network");
      }
      if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) { await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt)); continue; }
      throw new ProviderRequestError(`Provider request failed (HTTP ${response.status}). Check connection permissions and quota.`, response.status === 429 ? "rate_limited" : "http", response.status, null, providerCode);
    }
    throw new Error("Provider retries exhausted.");
  } finally { await redis.eval('if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end', 1, lockKey, token); }
}
