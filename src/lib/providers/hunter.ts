import "server-only";
import { z } from "zod";
import { providerJson } from "./http";
export interface ContactEnrichmentProvider {
  findPerson(domain: string): Promise<{ email: string; firstName: string | null; lastName: string | null; title: string | null; confidence: number; sources: string[] }[]>;
  findEmail(domain: string, firstName: string, lastName: string): Promise<string | null>;
  findPhone(): Promise<null>;
  verifyEmail(email: string): Promise<{ status: string; confidence: number }>;
}
export function hunterProvider(workspaceId: string, apiKey: string): ContactEnrichmentProvider & { healthCheck(): Promise<{ ok: boolean; message: string }>; findEmailDetailed(domain: string, firstName: string, lastName: string): Promise<{ email: string | null; score: number | null; acceptAll: boolean | null; verification: string | null }> } {
  async function call(path: string, params: Record<string, string>) { const url = new URL(`https://api.hunter.io/v2/${path}`); for (const [k, v] of Object.entries({ ...params, api_key: apiKey })) url.searchParams.set(k, v); return providerJson(workspaceId, "hunter", url.toString()); }
  return {
    async findPerson(domain) {
      const data = z.object({ data: z.object({ emails: z.array(z.object({ value: z.string().email(), first_name: z.string().nullable(), last_name: z.string().nullable(), position: z.string().nullable(), confidence: z.number(), sources: z.array(z.object({ uri: z.string() })).default([]) })) }) }).parse(await call("domain-search", { domain, limit: "10", type: "personal" }));
      return data.data.emails.map(e => ({ email: e.value, firstName: e.first_name, lastName: e.last_name, title: e.position, confidence: e.confidence, sources: e.sources.map(s => s.uri) }));
    },
    async findEmail(domain, firstName, lastName) { const data = z.object({ data: z.object({ email: z.string().email().nullable() }) }).parse(await call("email-finder", { domain, first_name: firstName, last_name: lastName })); return data.data.email; },
    /** Email Finder with its score and Hunter's own verification, for the fallback chain. One credit, only when found. */
    async findEmailDetailed(domain: string, firstName: string, lastName: string) {
      const data = z.object({ data: z.object({ email: z.string().email().nullable(), score: z.number().nullish(), position: z.string().nullish(), accept_all: z.boolean().nullish(), verification: z.object({ status: z.string().nullish() }).nullish() }).passthrough() }).parse(await call("email-finder", { domain, first_name: firstName, last_name: lastName }));
      return { email: data.data.email, score: data.data.score ?? null, acceptAll: data.data.accept_all ?? null, verification: data.data.verification?.status ?? null };
    },
    async findPhone() { return null; },
    async verifyEmail(email) {
      const data = z.object({ data: z.object({ status: z.string(), score: z.number().optional(), disposable: z.boolean().optional(), accept_all: z.boolean().optional() }) }).parse(await call("email-verifier", { email }));
      return { status: data.data.disposable ? "DISPOSABLE" : data.data.accept_all ? "ACCEPT_ALL" : ({ valid: "VALID", invalid: "INVALID", accept_all: "ACCEPT_ALL", webmail: "RISKY", disposable: "DISPOSABLE", unknown: "UNKNOWN" } as Record<string, string>)[data.data.status] ?? "UNKNOWN", confidence: data.data.score ?? 0 };
    },
    async healthCheck() { await call("account", {}); return { ok: true, message: "Hunter account API responded successfully." }; },
  };
}
