import "server-only";
import { z } from "zod";
import { providerJson } from "./http";
import { normalizedCompany, normalizedDomain } from "@/lib/opportunities/identity";
const profile = z.object({ uid: z.string(), fullName: z.string(), contacts: z.array(z.object({ type: z.string(), value: z.string(), subType: z.string().nullish(), rating: z.number().optional() })).nullish(), experience: z.array(z.object({ company: z.string(), position: z.string().nullish(), current: z.boolean().optional(), website: z.string().nullish() })).nullish() });
export function signalHireProvider(workspaceId: string, apiKey: string) {
  const call = (path: string, body?: Record<string, unknown>) => providerJson(workspaceId, "signalhire", `https://www.signalhire.com/api/v1/${path}`, { apikey: apiKey }, body);
  return {
    async healthCheck() { const result = z.object({ credits: z.number() }).parse(await call("credits")); return { ok: true, message: `SignalHire connected. ${result.credits} contact credits available.` }; },
    /**
     * Contacts for one LinkedIn profile through the Person API in its synchronous mode
     * (`withoutWaterfall`): SignalHire otherwise delivers results only to a public callback URL and
     * cannot be polled, which a self-hosted app has no way to receive. Synchronous mode reads
     * SignalHire's own stored data only, so coverage is lower. Charged per successful match.
     */
    async lookupByLinkedIn(linkedinUrl: string) {
      const rows = z.array(z.object({ item: z.string(), status: z.string(), candidate: profile.optional() })).parse(await call("candidate/search", { items: [linkedinUrl], withoutWaterfall: true }));
      const row = rows[0];
      if (!row) return { status: "failed", candidate: null };
      return { status: row.status, candidate: row.status === "success" ? row.candidate ?? null : null };
    },
    async findPerson(company: string, domain?: string | null) {
      const search = z.object({ profiles: z.array(z.object({ uid: z.string() })) }).parse(await call("candidate/searchByQuery", { currentCompany: `"${company.replace(/["\\]/g, "")}"`, currentTitle: 'CTO OR CIO OR CFO OR COO OR Founder OR Director OR "Head of" OR Procurement', size: 10 }));
      if (!search.profiles.length) return [];
      const result = z.array(z.object({ item: z.string(), status: z.string(), candidate: profile.optional() })).parse(await call("candidate/search", { items: search.profiles.map(p => p.uid), withoutWaterfall: true }));
      return result.flatMap(row => {
        if (row.status !== "success" || !row.candidate) return [];
        const p = row.candidate;
        const role = p.experience?.find(e => e.current === true && (normalizedCompany(e.company) === normalizedCompany(company) || (domain && e.website && normalizedDomain(e.website) === normalizedDomain(domain))));
        if (!role?.position || (domain && role.website && normalizedDomain(role.website) !== normalizedDomain(domain))) return [];
        // Only work emails. A provider confidence rating is not a fresh verification.
        const names = p.fullName.trim().split(/\s+/);
        return (p.contacts ?? []).filter(c => c.type === "email" && c.subType === "work" && z.string().email().safeParse(c.value).success).map(c => ({ email: c.value, firstName: names[0], lastName: names.slice(1).join(" ") || null, title: role.position!, confidence: c.rating ?? 0, sources: [`signalhire:${p.uid}`] }));
      });
    },
  };
}
