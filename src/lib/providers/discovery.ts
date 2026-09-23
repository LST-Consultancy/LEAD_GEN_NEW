import "server-only";
import { z } from "zod";
import { providerJson } from "./http";
import { PartialDiscoveryError, type OpportunitySourceProvider } from "./opportunity-source";
import type { SearchCriteria } from "@/lib/opportunities/query-parser";
import { plainText, sourceDate, type SourceDocument } from "@/lib/opportunities/extractor";
import { canonicalUrl } from "@/lib/opportunities/identity";
export const boardSchema = z.object({ slug: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), company: z.string().min(2).max(200), domain: z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i), country: z.string().max(80).optional() });
export const providerConfigSchema = z.object({ boards: z.array(boardSchema).max(50).default([]), appId: z.string().max(200).default(""), countries: z.array(z.enum(["us", "gb", "in", "au", "at", "br", "ca", "de", "fr", "it", "nl", "nz", "pl", "sg", "za"])).max(15).default(["us", "gb", "in"]), maxQueries: z.number().int().min(1).max(6).default(3), pages: z.number().int().min(1).max(3).default(1), includeLinkedIn: z.boolean().default(true) });
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
const jobSchema = z.object({ id: z.union([z.string(), z.number()]), title: z.string(), absolute_url: z.string(), content: z.string().default(""), updated_at: z.string().optional(), location: z.object({ name: z.string() }).optional() });
const leverSchema = z.object({ id: z.string(), text: z.string(), hostedUrl: z.string(), applyUrl: z.string().optional(), descriptionPlain: z.string().default(""), createdAt: z.number().optional(), categories: z.object({ location: z.string().optional(), commitment: z.string().optional() }).optional() });
export function discoveryProvider(workspaceId: string, id: string, rawConfig: z.input<typeof providerConfigSchema>, key?: string): OpportunitySourceProvider {
  const config = providerConfigSchema.parse(rawConfig);
  async function search(query: SearchCriteria): Promise<SourceDocument[]> {
    const records: SourceDocument[] = [];
    try {
    if (id === "adzuna" || id === "ashby") {
      const { searchJobNetwork } = await import("./job-networks");
      return searchJobNetwork(workspaceId, id, config, query, key);
    }
    if (id === "greenhouse" || id === "lever") {
      for (const board of config.boards) {
        const url = id === "greenhouse" ? `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs?content=true` : `https://api.lever.co/v0/postings/${board.slug}?mode=json&limit=100`;
        const data = await providerJson(workspaceId, id, url);
        if (id === "greenhouse") for (const j of z.object({ jobs: z.array(jobSchema).max(10000) }).parse(data).jobs.slice(0, 500)) records.push({ provider: id, kind: "JOB_BOARD", externalId: `${board.slug}:${j.id}`, sourceUrl: canonicalUrl(j.absolute_url), title: j.title, description: plainText(j.content), company: { name: board.company, domain: board.domain, country: board.country }, location: j.location?.name, postedAt: null, updatedAt: sourceDate(j.updated_at), status: "ACTIVE", rawSourceReference: { board: board.slug, id: j.id } });
        else for (const j of z.array(leverSchema).max(10000).parse(data)) records.push({ provider: id, kind: "JOB_BOARD", externalId: `${board.slug}:${j.id}`, sourceUrl: canonicalUrl(j.hostedUrl), applicationUrl: j.applyUrl, title: j.text, description: plainText(j.descriptionPlain), company: { name: board.company, domain: board.domain, country: board.country }, location: j.categories?.location, employmentType: j.categories?.commitment, postedAt: sourceDate(j.createdAt), status: "ACTIVE", rawSourceReference: { board: board.slug, id: j.id } });
      }
      return [...new Map(records.map(r => [r.externalId, r])).values()];
    }
    if (id === "brave") {
      if (!key) throw new Error("Brave credentials are missing.");
      // Three bounded requests. Query terms are shown before execution.
      for (const term of [...query.expandedTerms.slice(0, config.maxQueries), ...(config.includeLinkedIn ? query.expandedTerms.slice(0, 2).map(t => `${t} site:linkedin.com/posts/`) : [])]) {
        const q = [term.replaceAll('"', ''), ...query.negativeKeywords.map(t => `-"${t.replaceAll('"', '')}"`), ...(query.domains.length ? [`(${query.domains.map(d => `site:${d}`).join(" OR ")})`] : [])].join(" ");
        const url = new URL("https://api.search.brave.com/res/v1/web/search"); url.searchParams.set("q", q); url.searchParams.set("count", "20"); url.searchParams.set("freshness", query.dateRange.days <= 7 ? "pw" : query.dateRange.days <= 31 ? "pm" : "py");
        if (query.locations[0]) url.searchParams.set("country", ({ "United States": "US", "United Kingdom": "GB", "India": "IN", "United Arab Emirates": "AE" } as Record<string, string>)[query.locations[0]] ?? "ALL");
        const schema = z.object({ web: z.object({ results: z.array(z.object({ title: z.string(), url: z.string(), description: z.string().default(""), page_age: z.string().optional(), profile: z.object({ name: z.string().optional() }).optional() })) }).optional() });
        const data = schema.parse(await providerJson(workspaceId, id, url.toString(), { "X-Subscription-Token": key }));
        for (const r of data.web?.results ?? []) {
          const sourceUrl = canonicalUrl(r.url); const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
          // Only explicitly configured company domains can be attributed safely. A news publisher is not the buyer.
          const board = config.boards.find(b => host === b.domain || host.endsWith(`.${b.domain}`));

          records.push({ provider: id, kind: host === "linkedin.com" || host.endsWith(".linkedin.com") ? "LINKEDIN_PUBLIC_POST" : "PUBLIC_WEB", externalId: sourceUrl, sourceUrl, title: r.title, description: plainText(r.description), company: board ? { name: board.company, domain: board.domain, country: board.country } : { name: "" }, postedAt: null, status: "UNKNOWN", rawSourceReference: { searchQuery: q, sourcePageAge: r.page_age ?? null, resultTitle: r.title, resultSnippet: plainText(r.description) } });
        }
      }
      return [...new Map(records.map(r => [r.externalId, r])).values()];
    }
    throw new Error(id === "linkedin" ? "LinkedIn capability unavailable for this connection." : "Provider adapter unavailable.");
    } catch (error) { if (error instanceof PartialDiscoveryError) throw error; throw new PartialDiscoveryError(error instanceof Error ? error.message : "Discovery failed", records); }
  }
  return { id, search, getOpportunity: async externalId => (await search({ services: [], technologies: [], opportunityTypes: [], locations: [], industries: [], employeeMin: null, employeeMax: null, dateRange: { days: 30 }, minimumIntent: 0, expandedTerms: [], negativeKeywords: [], domains: [] })).find(r => r.externalId === externalId) ?? null,
    getChanges: async () => { throw new Error("Changes are detected by persisted source hashes during refresh."); },
    healthCheck: async () => { if (!["brave", "greenhouse", "lever", "ashby", "adzuna"].includes(id)) return { ok: false, message: "LinkedIn capability unavailable for this connection." }; if (["greenhouse", "lever", "ashby"].includes(id) && !config.boards.length) return { ok: false, message: "Configure at least one company board/domain." }; await search({ services: [], technologies: [], opportunityTypes: [], locations: [], industries: [], employeeMin: null, employeeMax: null, dateRange: { days: 30 }, minimumIntent: 0, expandedTerms: ["implementation"], negativeKeywords: [], domains: [] }); return { ok: true, message: "Provider API responded successfully." }; },
    getCapabilities: () => ({ search: ["brave", "greenhouse", "lever", "ashby", "adzuna"].includes(id), enrichment: false, verification: false, changes: false }) };
}
