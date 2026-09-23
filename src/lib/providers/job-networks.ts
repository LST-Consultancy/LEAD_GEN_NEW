import "server-only";
import { PartialDiscoveryError } from "./opportunity-source";
import { z } from "zod";
import { providerJson } from "./http";
import type { ProviderConfig } from "./discovery";
import type { SearchCriteria } from "@/lib/opportunities/query-parser";
import { plainText, sourceDate, type SourceDocument } from "@/lib/opportunities/extractor";
import { canonicalUrl } from "@/lib/opportunities/identity";
const COUNTRIES: Record<string, string> = { us: "United States", gb: "United Kingdom", in: "India", au: "Australia", at: "Austria", br: "Brazil", ca: "Canada", de: "Germany", fr: "France", it: "Italy", nl: "Netherlands", nz: "New Zealand", pl: "Poland", sg: "Singapore", za: "South Africa" };
export async function searchJobNetwork(workspaceId: string, id: string, config: ProviderConfig, query: SearchCriteria, key?: string): Promise<SourceDocument[]> {
  const records: SourceDocument[] = [];
  try {
  if (id === "ashby") {
    for (const board of config.boards) {
      const result = z.object({ jobs: z.array(z.object({ title: z.string(), jobUrl: z.string(), descriptionPlain: z.string().default(""), publishedAt: z.string().nullish(), location: z.string().optional(), employmentType: z.string().optional(), isListed: z.boolean().default(true) })) }).parse(await providerJson(workspaceId, id, `https://api.ashbyhq.com/posting-api/job-board/${board.slug}`));
      for (const job of result.jobs.filter(j => j.isListed).slice(0, 500)) records.push({ provider: id, kind: "JOB_BOARD", externalId: canonicalUrl(job.jobUrl), sourceUrl: canonicalUrl(job.jobUrl), title: job.title, description: plainText(job.descriptionPlain), postedAt: sourceDate(job.publishedAt), location: job.location, employmentType: job.employmentType, company: { name: board.company, domain: board.domain, country: board.country }, status: "ACTIVE", rawSourceReference: { board: board.slug } });
    }
  } else {
    if (!key || !config.appId) throw new Error("Adzuna needs an app ID and API key.");
    const countries = config.countries.filter(c => !query.locations.length || query.locations.some(l => l.toLowerCase() === COUNTRIES[c].toLowerCase()));
    if (!countries.length) throw new Error("No configured Adzuna market matches the requested country.");
    const terms = [...new Set(query.technologies.length ? query.technologies : query.services.length ? query.services : query.expandedTerms)].slice(0, config.maxQueries);
    for (const country of countries) for (const term of terms) for (let page = 1; page <= config.pages; page++) {
      const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`);
      Object.entries({ app_id: config.appId, app_key: key, what: term, results_per_page: "50", sort_by: "date", max_days_old: String(query.dateRange.days), what_exclude: query.negativeKeywords.join(" ") }).forEach(([k,v]) => url.searchParams.set(k,v));
      const result = z.object({ results: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), redirect_url: z.string(), created: z.string().optional(), company: z.object({ display_name: z.string() }).optional(), location: z.object({ display_name: z.string() }).optional(), contract_type: z.string().optional() })) }).parse(await providerJson(workspaceId, id, url.toString()));
      for (const job of result.results) records.push({ provider: id, kind: "JOB_BOARD", externalId: `${country}:${job.id}`, sourceUrl: canonicalUrl(job.redirect_url), title: plainText(job.title), description: plainText(job.description), postedAt: sourceDate(job.created), location: job.location?.display_name, employmentType: job.contract_type, company: { name: job.company?.display_name ?? "", country: COUNTRIES[country] }, status: "UNKNOWN", rawSourceReference: { country, id: job.id, attribution: "Adzuna", descriptionIsSnippet: true } });
      if (result.results.length < 50) break;
    }
  }
  return [...new Map(records.map(r => [r.externalId, r])).values()];
  } catch (error) { throw new PartialDiscoveryError(error instanceof Error ? error.message : "Job discovery failed", records); }
}
