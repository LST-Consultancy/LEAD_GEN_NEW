import "server-only";
import { z } from "zod";
import { providerJson } from "./http";
import { normalizedCompany, normalizedDomain } from "@/lib/opportunities/identity";

/**
 * SignalHire, per docs.signalhire.com (checked 2026-09-25). Two object shapes:
 * - Search profile (Search API): `{ uid, fullName, location, experience[{ company, title }], skills,
 *   contactsFetched, openToWork }` — no contacts, no LinkedIn URL, no "current" flag.
 * - Candidate (Person API): `{ uid, fullName, headLine, locations[{name}], experience[{ position,
 *   company, current, started, ended, companyUrl, website, … }], social[{ type, link, rating }],
 *   contacts[{ type, value, rating, subType }] }`. Missing strings come back as "n/a" or null.
 */
const na = (v: string | null | undefined) => (v && v !== "n/a" ? v : null);
export const candidateSchema = z.object({
  uid: z.string(), fullName: z.string(), headLine: z.string().nullish(),
  locations: z.array(z.object({ name: z.string().nullish() })).nullish(),
  contacts: z.array(z.object({ type: z.string(), value: z.string(), subType: z.string().nullish(), rating: z.number().optional() })).nullish(),
  social: z.array(z.object({ type: z.string(), link: z.string().nullish(), rating: z.number().optional() })).nullish(),
  experience: z.array(z.object({ company: z.string().nullish(), position: z.string().nullish(), current: z.boolean().optional(), website: z.string().nullish(), companyUrl: z.string().nullish(), started: z.string().nullish(), ended: z.string().nullish() })).nullish(),
}).passthrough();
export type SignalHireCandidate = z.infer<typeof candidateSchema>;
const searchProfile = z.object({ uid: z.string(), fullName: z.string().nullish(), location: z.string().nullish(), experience: z.array(z.object({ company: z.string().nullish(), title: z.string().nullish() })).nullish(), openToWork: z.boolean().optional() }).passthrough();
export type SignalHireSearchProfile = z.infer<typeof searchProfile>;
const personRows = z.array(z.object({ item: z.string(), status: z.string(), candidate: candidateSchema.optional() }));

export function signalHireProvider(workspaceId: string, apiKey: string) {
  const call = (path: string, body?: Record<string, unknown>) => providerJson(workspaceId, "signalhire", `https://www.signalhire.com/api/v1/${path}`, { apikey: apiKey }, body);
  const person = async (item: string) => {
    const rows = personRows.parse(await call("candidate/search", { items: [item], withoutWaterfall: true }));
    const row = rows[0];
    if (!row) return { status: "failed", candidate: null as SignalHireCandidate | null };
    return { status: row.status, candidate: row.status === "success" ? row.candidate ?? null : null };
  };
  return {
    async healthCheck() { const result = z.object({ credits: z.number() }).parse(await call("credits")); return { ok: true, message: `SignalHire connected. ${result.credits} contact credits available.` }; },
    /**
     * Contacts for one LinkedIn profile through the Person API in its synchronous mode
     * (`withoutWaterfall`): SignalHire otherwise delivers results only to a public callback URL and
     * cannot be polled, which a self-hosted app has no way to receive. Synchronous mode reads
     * SignalHire's own stored data only, so coverage is lower. Charged per successful match.
     */
    lookupByLinkedIn: (linkedinUrl: string) => person(linkedinUrl),
    /** The same Person API for a search result's uid. Charged per successful match. */
    lookupByUid: (uid: string) => person(uid),
    /** People at a company by name, from the Search API. No credits; uses the daily search quota. */
    async searchPeople(company: string, titles: string[], size = 10) {
      const body: Record<string, unknown> = { currentCompany: `"${company.replace(/["\\]/g, "")}"`, size: Math.min(100, Math.max(1, size)) };
      if (titles.length) body.currentTitle = titles.map(t => (t.includes(" ") ? `"${t.replace(/"/g, "")}"` : t)).join(" OR ");
      const r = z.object({ total: z.number().optional(), profiles: z.array(searchProfile) }).parse(await call("candidate/searchByQuery", body));
      return r.profiles;
    },
    /** People by full name, optionally at a company, from the Search API. No credits; uses the daily search quota. */
    async searchByName(fullName: string, company: string | null, size = 10) {
      const body: Record<string, unknown> = { fullName: `"${fullName.replace(/["\\]/g, "")}"`, size: Math.min(100, Math.max(1, size)) };
      if (company) body.currentCompany = `"${company.replace(/["\\]/g, "")}"`;
      const r = z.object({ total: z.number().optional(), profiles: z.array(searchProfile) }).parse(await call("candidate/searchByQuery", body));
      return r.profiles;
    },
    /** Legacy helper for the older opportunity action: people at a company with a work email. */
    async findPerson(company: string, domain?: string | null) {
      const profiles = await this.searchPeople(company, ["CTO", "CIO", "CFO", "COO", "Founder", "Director", "Head of", "Procurement"], 10);
      const out: { email: string; firstName: string; lastName: string | null; title: string; confidence: number; sources: string[] }[] = [];
      if (!profiles.length) return out;
      // One Person API request for all of them (it takes up to 100 items); charged per match.
      const rows = personRows.parse(await call("candidate/search", { items: profiles.map(p => p.uid), withoutWaterfall: true }));
      for (const row of rows) {
        const p = row.status === "success" ? row.candidate : null;
        if (!p) continue;
        const role = p.experience?.find(e => e.current === true && ((e.company && normalizedCompany(e.company) === normalizedCompany(company)) || (domain && na(e.website) && normalizedDomain(na(e.website)!) === normalizedDomain(domain))));
        if (!role?.position) continue;
        const names = p.fullName.trim().split(/\s+/);
        for (const c of p.contacts ?? []) if (c.type === "email" && c.subType === "work" && z.string().email().safeParse(c.value).success) out.push({ email: c.value, firstName: names[0], lastName: names.slice(1).join(" ") || null, title: role.position, confidence: c.rating ?? 0, sources: [`signalhire:${p.uid}`] });
      }
      return out;
    },
  };
}
