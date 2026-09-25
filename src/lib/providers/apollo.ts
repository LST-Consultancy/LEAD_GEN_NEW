import "server-only";
import { z } from "zod";
import { providerJson } from "./http";

/**
 * Apollo, through its documented REST API (docs.apollo.io, checked 2026-09-25): People Enrichment
 * (1 credit when data is found), People API Search (0 credits, obfuscated last names — each result
 * worth keeping is revealed with a paid match by id), Organization Enrichment by domain (1 credit)
 * and Organization Search by name (1 credit per page, paid plans). Personal emails and phone
 * numbers are never requested (phones need a public webhook and cost extra credits).
 */
const BASE = "https://api.apollo.io/api/v1";
const personSchema = z.object({ id: z.string().optional(), first_name: z.string().nullish(), last_name: z.string().nullish(), name: z.string().nullish(), title: z.string().nullish(), linkedin_url: z.string().nullish(), email: z.string().nullish(), email_status: z.string().nullish(), organization_id: z.string().nullish(), organization: z.object({ name: z.string().nullish(), primary_domain: z.string().nullish(), linkedin_url: z.string().nullish() }).passthrough().nullish(), employment_history: z.array(z.object({ organization_name: z.string().nullish(), title: z.string().nullish(), current: z.boolean().nullish() }).passthrough()).nullish() }).passthrough();
export type ApolloPerson = z.infer<typeof personSchema>;
const orgSchema = z.object({ id: z.string().nullish(), name: z.string().nullish(), website_url: z.string().nullish(), primary_domain: z.string().nullish(), linkedin_url: z.string().nullish(), industry: z.string().nullish(), estimated_num_employees: z.number().nullish(), city: z.string().nullish(), state: z.string().nullish(), country: z.string().nullish(), short_description: z.string().nullish(), phone: z.string().nullish() }).passthrough();
export type ApolloOrg = z.infer<typeof orgSchema>;
const matchSchema = z.object({ person: personSchema.nullish(), match_confidence: z.string().nullish() }).passthrough();

export function apolloProvider(workspaceId: string, apiKey: string) {
  const headers = { "x-api-key": apiKey, "Cache-Control": "no-cache" };
  return {
    async healthCheck() {
      const r = z.object({ healthy: z.boolean().optional(), is_logged_in: z.boolean().optional() }).passthrough().parse(await providerJson(workspaceId, "apollo", `${BASE}/auth/health`, headers));
      return r.is_logged_in ? { ok: true, message: "Apollo accepted the API key. Each people match can spend one Apollo credit." } : { ok: false, message: "Apollo answered but did not accept this API key." };
    },
    /** One person by LinkedIn URL, or by name plus the company's domain or name. */
    async matchPerson(p: { firstName: string | null; lastName: string | null; linkedinUrl: string | null }, company: { name: string; domain: string | null }) {
      const body: Record<string, unknown> = { reveal_personal_emails: false, reveal_phone_number: false };
      if (p.linkedinUrl) body.linkedin_url = p.linkedinUrl;
      if (p.firstName) body.first_name = p.firstName;
      if (p.lastName) body.last_name = p.lastName;
      if (company.domain) body.domain = company.domain; else if (company.name) body.organization_name = company.name;
      const r = matchSchema.parse(await providerJson(workspaceId, "apollo", `${BASE}/people/match`, headers, body));
      return { person: r.person ?? null, confidence: r.match_confidence ?? (r.person as { match_confidence?: string } | null | undefined)?.match_confidence ?? null };
    },
    /** Reveal one People Search result by its Apollo id. 1 credit when data is found. */
    async matchById(id: string) {
      const r = matchSchema.parse(await providerJson(workspaceId, "apollo", `${BASE}/people/match?id=${encodeURIComponent(id)}`, headers, { reveal_personal_emails: false, reveal_phone_number: false }));
      return { person: r.person ?? null, confidence: r.match_confidence ?? (r.person as { match_confidence?: string } | null | undefined)?.match_confidence ?? null };
    },
    /** People at a domain. 0 credits; last names come back obfuscated. */
    async peopleSearch(domain: string, titles: string[], perPage = 10) {
      const body: Record<string, unknown> = { q_organization_domains_list: [domain], page: 1, per_page: Math.min(100, Math.max(1, perPage)) };
      if (titles.length) { body.person_titles = titles; body.include_similar_titles = true; }
      const r = z.object({ people: z.array(z.object({ id: z.string(), first_name: z.string().nullish(), last_name_obfuscated: z.string().nullish(), title: z.string().nullish(), has_email: z.boolean().nullish(), organization: z.object({ name: z.string().nullish() }).passthrough().nullish() }).passthrough()).default([]) }).passthrough().parse(await providerJson(workspaceId, "apollo", `${BASE}/mixed_people/api_search`, headers, body));
      return r.people;
    },
    /** People by name keywords. 0 credits; last names come back obfuscated, so a choice is revealed with matchById. */
    async peopleSearchByName(name: string, perPage = 10) {
      const r = z.object({ people: z.array(z.object({ id: z.string(), first_name: z.string().nullish(), last_name_obfuscated: z.string().nullish(), title: z.string().nullish(), organization: z.object({ name: z.string().nullish() }).passthrough().nullish() }).passthrough()).default([]) }).passthrough().parse(await providerJson(workspaceId, "apollo", `${BASE}/mixed_people/api_search`, headers, { q_keywords: name, page: 1, per_page: Math.min(25, Math.max(1, perPage)) }));
      return r.people;
    },
    /** Company details by domain. 1 credit. */
    async orgEnrich(domain: string) {
      const r = z.object({ organization: orgSchema.nullish() }).passthrough().parse(await providerJson(workspaceId, "apollo", `${BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, headers));
      return r.organization ?? null;
    },
    /** Companies by name. 1 credit per page; paid plans only. */
    async orgSearch(name: string) {
      const r = z.object({ organizations: z.array(orgSchema).default([]) }).passthrough().parse(await providerJson(workspaceId, "apollo", `${BASE}/mixed_companies/search`, headers, { q_organization_name: name, page: 1, per_page: 5 }));
      return r.organizations;
    },
  };
}
