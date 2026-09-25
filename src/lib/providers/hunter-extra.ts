import "server-only";
import { z } from "zod";
import { providerJson } from "./http";

/**
 * Hunter calls used by the stage fallback, per hunter.io/api-documentation/v2 (checked 2026-09-25).
 * Kept apart from the older adapter so its interface stays as the legacy routes expect.
 */
export function hunterCalls(workspaceId: string, apiKey: string) {
  const call = (path: string, params: Record<string, string>) => {
    const url = new URL(`https://api.hunter.io/v2/${path}`);
    for (const [k, v] of Object.entries({ ...params, api_key: apiKey })) url.searchParams.set(k, v);
    return providerJson(workspaceId, "hunter", url.toString());
  };
  return {
    /** Name → domain. Free; `data[]` of `{ domain, company_name, email_count }`. */
    async domainFinder(company: string) {
      const r = z.object({ data: z.array(z.object({ domain: z.string(), company_name: z.string().nullish(), email_count: z.number().nullish() }).passthrough()).default([]) }).passthrough().parse(await call("domain-finder", { company, limit: "5" }));
      return r.data;
    },
    /** Company details by domain; 404 when unknown. */
    async companyFind(domain: string) {
      const r = z.object({ data: z.object({
        name: z.string().nullish(), domain: z.string().nullish(), description: z.string().nullish(),
        category: z.object({ industry: z.string().nullish(), sector: z.string().nullish() }).partial().nullish(),
        geo: z.object({ city: z.string().nullish(), state: z.string().nullish(), country: z.string().nullish() }).partial().nullish(),
        linkedin: z.object({ handle: z.string().nullish() }).partial().nullish(),
        metrics: z.object({ employees: z.string().nullish(), employeesCount: z.number().nullish() }).partial().nullish(),
      }).passthrough() }).passthrough().parse(await call("companies/find", { domain }));
      return r.data;
    },
    /** People with addresses Hunter has seen for a domain. `type=personal` leaves out role addresses. */
    async domainSearch(domain: string, limit = 10) {
      const r = z.object({ data: z.object({
        domain: z.string().nullish(), organization: z.string().nullish(), accept_all: z.boolean().nullish(),
        emails: z.array(z.object({ value: z.string(), type: z.string().nullish(), confidence: z.number().nullish(), first_name: z.string().nullish(), last_name: z.string().nullish(), position: z.string().nullish(), seniority: z.string().nullish(), department: z.string().nullish(), linkedin: z.string().nullish(), verification: z.object({ status: z.string().nullish(), date: z.string().nullish() }).nullish() }).passthrough()).default([]),
      }).passthrough() }).passthrough().parse(await call("domain-search", { domain, type: "personal", limit: String(Math.min(100, Math.max(1, limit))) }));
      return r.data;
    },
    /** One address for a named person at a domain. */
    async emailFinder(domain: string, firstName: string, lastName: string) {
      const r = z.object({ data: z.object({ email: z.string().nullish(), score: z.number().nullish(), position: z.string().nullish(), linkedin_url: z.string().nullish(), company: z.string().nullish(), accept_all: z.boolean().nullish(), verification: z.object({ status: z.string().nullish() }).nullish() }).passthrough() }).passthrough().parse(await call("email-finder", { domain, first_name: firstName, last_name: lastName }));
      return r.data;
    },
    /** Mailbox check. `status`: valid, invalid, accept_all, webmail, disposable, unknown. HTTP 202 = still checking. */
    async verify(email: string) {
      const r = z.object({ data: z.object({ status: z.string(), score: z.number().nullish(), result: z.string().nullish(), smtp_check: z.boolean().nullish(), accept_all: z.boolean().nullish(), disposable: z.boolean().nullish(), webmail: z.boolean().nullish(), block: z.boolean().nullish() }).passthrough() }).passthrough().parse(await call("email-verifier", { email }));
      return r.data;
    },
  };
}
