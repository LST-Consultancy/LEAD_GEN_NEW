import "server-only";
import { z } from "zod";
import { providerJson } from "./http";

/**
 * Apollo, through its documented REST API (docs.apollo.io, checked 2026-09-25). Only People
 * Enrichment is used: People API Search returns no emails, so it would cost a request and find
 * nothing this app needs. A match costs one Apollo credit when data is found; personal emails and
 * phone numbers are never requested (phones need a public webhook and cost extra credits).
 */
const BASE = "https://api.apollo.io/api/v1";
const personSchema = z.object({ id: z.string().optional(), first_name: z.string().nullish(), last_name: z.string().nullish(), title: z.string().nullish(), linkedin_url: z.string().nullish(), email: z.string().nullish(), email_status: z.string().nullish(), organization: z.object({ name: z.string().nullish(), primary_domain: z.string().nullish() }).nullish() }).passthrough();
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
      return { person: r.person ?? null, confidence: r.match_confidence ?? null };
    },
  };
}
