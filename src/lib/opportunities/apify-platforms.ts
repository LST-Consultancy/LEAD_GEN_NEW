import type { SearchCriteria } from "./query-parser";
import { plainText, sourceDate, type SourceDocument } from "./extractor";
import { canonicalUrl, normalizedDomain } from "./identity";
import { webQueryTerms } from "./web-queries";
import type { Routing } from "./offering";

/**
 * Multi-platform discovery through Apify Actors. One entry per platform: the Actor whose input and
 * output were checked (docs/provider-contracts.md, 2026-09-25), how a search becomes that Actor's
 * input, what one run is estimated to cost from its listed price, and how one result becomes a
 * source document. Pure; the I/O is `lib/providers/apify-discovery.ts`.
 *
 * Every platform declares what its results *are*, because they need different handling:
 * - `buying_request`: someone asking for a vendor or freelancer (Upwork, Reddit, web pages);
 * - `hiring`: a job posting — internal hiring, never proof of demand for a vendor;
 * - `business_prospect`: a business that exists (Google Maps) — fit evidence, no intent at all.
 */

export { APIFY_PLATFORM_IDS, isApifyPlatform, platformConfigSchema, PLATFORM_META, type ApifyPlatformId, type PlatformConfig, type ResultClass } from "./apify-platform-meta";
import { PLATFORM_META, type ApifyPlatformId, type PlatformConfig, type ResultClass } from "./apify-platform-meta";

export type PlannedRun = { label: string; input: Record<string, unknown>; maxItems: number; estimateUsd: number };
type Ctx = { criteria: SearchCriteria; config: PlatformConfig; routing?: Routing };
export type Platform = {
  id: ApifyPlatformId; name: string; actor: string; resultClass: ResultClass; kind: string;
  cookies: "none" | "optional"; priceNote: string;
  plan(ctx: Ctx): PlannedRun[];
  map(item: unknown, ctx: Ctx & { query: string }): SourceDocument | null;
  /** The longest window the platform can filter on, in days; longer searches run unfiltered and are checked here. */
  maxFilterDays: number | null;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const url = (v: unknown) => { const s = str(v); if (!s) return null; try { return canonicalUrl(s); } catch { return null; } };
const round = (n: number) => Math.round(n * 10000) / 10000;
const COUNTRY_NAME: Record<string, string> = { IN: "India", US: "United States", GB: "United Kingdom", AE: "United Arab Emirates", SG: "Singapore", AU: "Australia", CA: "Canada", DE: "Germany", FR: "France", NL: "Netherlands" };
/** A country code as the name a search is written with; an unknown code is kept as the code, never guessed. */
export const countryName = (code: string | null) => (code ? COUNTRY_NAME[code.toUpperCase()] ?? code.toUpperCase() : undefined);

/** Role and technology terms for job boards: a job title is what their search matches. An offering's job titles come first. */
export function jobTerms(c: SearchCriteria, max: number, routing?: Routing) {
  return [...new Set([...(routing?.jobTitles ?? []), ...c.technologies, ...c.services, ...c.expandedTerms].map(t => t.trim()).filter(Boolean))].slice(0, max);
}
/** Buyer-phrased queries for request platforms. An offering's own buyer phrases come first. */
export function requestTerms(c: SearchCriteria, max: number, routing?: Routing) {
  return [...new Set([...(routing?.buyerPhrases ?? []), ...webQueryTerms(c, max)].map(t => t.trim()).filter(Boolean))].slice(0, max);
}
/** The smallest supported filter that still covers the whole window; never a shorter one. */
export function coveringFilter<T>(days: number, options: [number, T][], unfiltered: T): T {
  const fit = options.filter(([d]) => d >= days).sort((a, b) => a[0] - b[0])[0];
  return fit ? fit[1] : unfiltered;
}
/** True when a result's date is inside the window; an undated result is kept and shown as undated. */
export const withinWindow = (postedAt: string | null, days: number, now = new Date()) => !postedAt || now.getTime() - Date.parse(postedAt) <= days * 86400000;

const relativeDate = (v: unknown, now = new Date()) => {
  const s = str(v); if (!s) return null;
  const iso = sourceDate(s); if (iso) return iso;
  const m = /(\d+)\s*\+?\s*(minute|hour|day|week|month)s?\s+ago/i.exec(s);
  if (!m) return /just now|today/i.test(s) ? now.toISOString() : null;
  const unit = { minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3 }[m[2].toLowerCase() as "day"];
  return new Date(now.getTime() - Number(m[1]) * unit).toISOString();
};

export const PLATFORMS: Record<ApifyPlatformId, Platform> = {
  apify_linkedin_jobs: {
    id: "apify_linkedin_jobs", ...PLATFORM_META.apify_linkedin_jobs, kind: "JOB_BOARD", cookies: "none", maxFilterDays: 30,
    plan: ({ criteria, config, routing }) => jobTerms(criteria, config.maxQueries, routing).map(term => ({ label: term, maxItems: config.maxItemsPerQuery, estimateUsd: round(0.00005 + config.maxItemsPerQuery * 0.002),
      input: { keywords: term, location: config.location || criteria.locations[0] || "", datePosted: coveringFilter(criteria.dateRange.days, [[1, "past24Hours"], [7, "pastWeek"], [30, "pastMonth"]], "anyTime"), limitPerSource: config.maxItemsPerQuery, scrapeCompany: true } })),
    map: (item, { query }) => {
      const r = obj(item); const link = url(r.link); const title = str(r.title);
      if (!link || !title) return null;
      return { provider: "apify_linkedin_jobs", kind: "JOB_BOARD", externalId: str(r.id) ?? link, sourceUrl: link, title, description: plainText(str(r.descriptionText) ?? ""),
        company: { name: str(r.companyName) ?? "", domain: normalizedDomain(str(r.companyWebsite) ?? undefined) ?? undefined, employees: num(r.companyEmployeesCount) ?? undefined, industry: str(r.industries) ?? undefined },
        location: str(r.location) ?? undefined, employmentType: str(r.employmentType) ?? undefined, postedAt: sourceDate(r.postedAt), applicationUrl: url(r.applyUrl) ?? undefined, status: "ACTIVE",
        rawSourceReference: { platform: "LinkedIn jobs", searchTerm: query, companyLinkedinUrl: str(r.companyLinkedinUrl), jobPosterName: str(r.jobPosterName), jobPosterTitle: str(r.jobPosterTitle), jobPosterProfileUrl: str(r.jobPosterProfileUrl) } };
    },
  },
  apify_indeed: {
    id: "apify_indeed", ...PLATFORM_META.apify_indeed, kind: "JOB_BOARD", cookies: "none", maxFilterDays: 14,
    plan: ({ criteria, config, routing }) => jobTerms(criteria, config.maxQueries, routing).map(term => ({ label: term, maxItems: config.maxItemsPerQuery, estimateUsd: round(0.001 + config.maxItemsPerQuery * 0.0001),
      input: { country: config.country, title: term, location: config.location || criteria.locations[0] || "", limit: config.maxItemsPerQuery, datePosted: coveringFilter(criteria.dateRange.days, [[1, "1"], [3, "3"], [7, "7"], [14, "14"]], "") } })),
    map: (item, { query }) => {
      const r = obj(item); const link = url(r.jobUrl) ?? url(r.url); const title = str(r.title);
      if (!link || !title) return null;
      const employer = obj(r.employer); const loc = obj(r.location);
      return { provider: "apify_indeed", kind: "JOB_BOARD", externalId: str(r.key) ?? link, sourceUrl: link, title, description: plainText(str(obj(r.description).text) ?? ""),
        company: { name: str(employer.name) ?? "", domain: normalizedDomain(str(employer.corporateWebsite) ?? undefined) ?? undefined, industry: str(employer.industry) ?? undefined, employees: num(employer.employeesCount) ?? undefined, country: countryName(str(loc.countryCode)) },
        location: [str(loc.city), countryName(str(loc.countryCode))].filter(Boolean).join(", ") || undefined, postedAt: sourceDate(r.datePublished), status: "ACTIVE",
        rawSourceReference: { platform: "Indeed", searchTerm: query } };
    },
  },
  apify_naukri: {
    id: "apify_naukri", ...PLATFORM_META.apify_naukri, kind: "JOB_BOARD", cookies: "none", maxFilterDays: 30,
    plan: ({ criteria, config, routing }) => jobTerms(criteria, config.maxQueries, routing).map(term => ({ label: term, maxItems: config.maxItemsPerQuery, estimateUsd: round(0.001 + config.maxItemsPerQuery * 0.0015),
      input: { jobBoard: "naukri", keyword: term, maxJobs: config.maxItemsPerQuery, sortBy: "date", fetchDetails: false, freshness: coveringFilter(criteria.dateRange.days, [[1, "1"], [3, "3"], [7, "7"], [15, "15"], [30, "30"]], "all"), ...(config.location ? { cities: [config.location] } : {}) } })),
    map: (item, { query }) => {
      const r = obj(item); const jd = str(r.jdURL); const link = url(jd?.startsWith("/") ? `https://www.naukri.com${jd}` : jd); const title = str(r.title);
      if (!link || !title) return null;
      return { provider: "apify_naukri", kind: "JOB_BOARD", externalId: str(r.jobId) ?? link, sourceUrl: link, title, description: plainText([str(r.jobDescription), str(r.tagsAndSkills)].filter(Boolean).join(" · ")),
        company: { name: str(r.companyName) ?? "", country: "India" }, location: str(r.location) ?? undefined, postedAt: relativeDate(r.createdDate), status: "ACTIVE",
        rawSourceReference: { platform: "Naukri", searchTerm: query, experience: str(r.experience), salary: str(r.salary) } };
    },
  },
  apify_google_search: {
    id: "apify_google_search", ...PLATFORM_META.apify_google_search, kind: "PUBLIC_WEB", cookies: "none", maxFilterDays: 365,
    plan: ({ criteria, config, routing }) => {
      const terms = requestTerms(criteria, config.maxQueries, routing);
      if (!terms.length) return [];
      const d = criteria.dateRange.days;
      // One run with every query, one per line: the Actor's `queries` is a string, not an array.
      return [{ label: terms.join(" · "), maxItems: terms.length, estimateUsd: round(0.001 + terms.length * 0.0045),
        input: { queries: terms.join("\n"), maxPagesPerQuery: 1, countryCode: config.country, quickDateRange: d <= 1 ? "d1" : d <= 7 ? "w1" : d <= 31 ? "m1" : d <= 365 ? "y1" : "" } }];
    },
    map: () => null, // one item per results page; see mapGooglePage
  },
  apify_reddit: {
    id: "apify_reddit", ...PLATFORM_META.apify_reddit, kind: "COMMUNITY_POST", cookies: "none", maxFilterDays: 365,
    plan: ({ criteria, config, routing }) => {
      const terms = requestTerms(criteria, config.maxQueries, routing).map(t => t.replaceAll('"', ""));
      if (!terms.length) return [];
      const d = criteria.dateRange.days;
      return [{ label: terms.join(" · "), maxItems: config.maxItemsPerQuery * terms.length, estimateUsd: round(0.02 + config.maxItemsPerQuery * terms.length * 0.004),
        input: { searches: terms, searchPosts: true, searchComments: false, searchCommunities: false, searchUsers: false, skipComments: true, sort: "new", time: d <= 1 ? "day" : d <= 7 ? "week" : d <= 31 ? "month" : d <= 365 ? "year" : "all", maxItems: config.maxItemsPerQuery * terms.length, maxPostCount: config.maxItemsPerQuery, includeNSFW: false } }];
    },
    map: (item, { query }) => {
      const r = obj(item); const link = url(r.url); const title = str(r.title);
      if (!link || !title || r.dataType === "comment" || r.over18 === true) return null;
      return { provider: "apify_reddit", kind: "COMMUNITY_POST", externalId: str(r.id) ?? link, sourceUrl: link, title, description: plainText(str(r.body) ?? ""),
        // A Reddit username is not a company. The buyer must be named in the text or the post goes to review.
        company: { name: "" }, postedAt: sourceDate(r.createdAt), status: "UNKNOWN",
        rawSourceReference: { platform: "Reddit", searchTerm: query, community: str(r.communityName), authorName: str(r.username) } };
    },
  },
  apify_upwork: {
    id: "apify_upwork", ...PLATFORM_META.apify_upwork, kind: "FREELANCE_PROJECT", cookies: "optional", maxFilterDays: 30,
    plan: ({ criteria, config, routing }) => jobTerms(criteria, config.maxQueries, routing).map(term => ({ label: term, maxItems: config.maxItemsPerQuery, estimateUsd: round(config.maxItemsPerQuery * 0.007),
      input: { query: term, sort: "newest", perPage: Math.min(50, config.maxItemsPerQuery), pagesToScrape: 1, maxJobAge: { value: Math.min(criteria.dateRange.days, 30), unit: "days" } } })),
    map: (item, { query }) => {
      const r = obj(item); const link = url(r.url); const title = str(r.title);
      if (!link || !title) return null;
      const client = str(r.clientName); const confident = (num(r.clientNameConfidence) ?? 0) >= 0.8 || r.clientNameConfidence === "high";
      return { provider: "apify_upwork", kind: "FREELANCE_PROJECT", externalId: str(r.id) ?? link, sourceUrl: link, title, description: plainText(str(r.description) ?? ""),
        company: { name: client && confident ? client : "", country: str(r.clientLocation) ?? undefined }, location: str(r.clientLocation) ?? undefined, postedAt: sourceDate(r.absoluteDate) ?? relativeDate(r.relativeDate), status: "OPEN",
        rawSourceReference: { platform: "Upwork", searchTerm: query, budget: r.budget ?? null, jobType: str(r.jobType), paymentVerified: r.paymentVerified ?? null, clientNameShown: client, clientNameConfidence: r.clientNameConfidence ?? null } };
    },
  },
  apify_google_maps: {
    id: "apify_google_maps", ...PLATFORM_META.apify_google_maps, kind: "BUSINESS_LISTING", cookies: "none", maxFilterDays: null,
    plan: ({ criteria, config, routing }) => {
      const queries = config.mapsQueries.length ? config.mapsQueries : routing?.prospectCategories.length ? routing.prospectCategories : criteria.industries.slice(0, config.maxQueries);
      const where = config.location || criteria.locations[0] || "";
      if (!queries.length || !where) return [];
      return [{ label: `${queries.join(", ")} in ${where}`, maxItems: config.maxItemsPerQuery * queries.length, estimateUsd: round(0.00005 + config.maxItemsPerQuery * queries.length * 0.004),
        input: { searchStringsArray: queries, locationQuery: where, maxCrawledPlacesPerSearch: config.maxItemsPerQuery, language: "en", skipClosedPlaces: true, scrapeContacts: false, maxReviews: 0 } }];
    },
    map: () => null, // business listings are prospects, not opportunities; see mapPlace
  },
  apify_websites: {
    id: "apify_websites", ...PLATFORM_META.apify_websites, kind: "PUBLIC_WEB", cookies: "none", maxFilterDays: null,
    plan: ({ config }) => config.startUrls.length ? [{ label: config.startUrls.join(", "), maxItems: config.maxItemsPerQuery, estimateUsd: round(config.maxItemsPerQuery * 0.002),
      input: { startUrls: config.startUrls.map(u => ({ url: u })), crawlerType: "cheerio", maxCrawlPages: config.maxItemsPerQuery, maxCrawlDepth: 2, maxResults: config.maxItemsPerQuery, respectRobotsTxtFile: true, saveMarkdown: false } }] : [],
    map: (item, { query }) => {
      const r = obj(item); const link = url(r.url); const meta = obj(r.metadata); const title = str(meta.title) ?? link;
      const text = plainText(str(r.text) ?? "");
      if (!link || !title || text.length < 80) return null;
      // A page on a company's own site speaks for that company; nothing else is assumed.
      return { provider: "apify_websites", kind: "PUBLIC_WEB", externalId: link, sourceUrl: link, title, description: text.slice(0, 8000), company: { name: "", domain: normalizedDomain(link) ?? undefined }, postedAt: null, status: "UNKNOWN",
        rawSourceReference: { platform: "Public website", startUrls: query, metaDescription: str(meta.description) } };
    },
  },
};

/** Google Search returns one item per results page; each organic result is one page to assess. */
export function mapGooglePage(item: unknown): SourceDocument[] {
  const r = obj(item); const term = str(obj(r.searchQuery).term) ?? "";
  const out: SourceDocument[] = [];
  for (const o of Array.isArray(r.organicResults) ? r.organicResults : []) {
    const x = obj(o); const link = url(x.url); const title = str(x.title);
    if (!link || !title) continue;
    const host = new URL(link).hostname.replace(/^www\./, "");
    const isPost = (host === "linkedin.com" || host.endsWith(".linkedin.com")) && /^\/(posts|feed\/update)\//.test(new URL(link).pathname);
    out.push({ provider: "apify_google_search", kind: isPost ? "LINKEDIN_PUBLIC_POST" : "PUBLIC_WEB", externalId: link, sourceUrl: link, title, description: plainText(str(x.description) ?? ""), company: { name: "" }, postedAt: null, status: "UNKNOWN",
      rawSourceReference: { platform: "Google Search", searchQuery: term, resultTitle: title, resultSnippet: plainText(str(x.description) ?? ""), position: num(x.position) } });
  }
  return out;
}

export type Place = { name: string; website: string | null; domain: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; countryCode: string | null; category: string | null; rating: number | null; reviews: number | null; mapsUrl: string | null; placeId: string | null; searchString: string | null };
/** A Google Maps place as a business prospect: what it is and where, never a buying intent. */
export function mapPlace(item: unknown): Place | null {
  const r = obj(item); const name = str(r.title);
  if (!name || r.permanentlyClosed === true) return null;
  const website = url(r.website);
  return { name, website, domain: normalizedDomain(website ?? undefined), phone: str(r.phone), address: str(r.address), city: str(r.city), state: str(r.state), countryCode: str(r.countryCode), category: str(r.categoryName), rating: num(r.totalScore), reviews: num(r.reviewsCount), mapsUrl: url(r.url), placeId: str(r.placeId), searchString: str(r.searchString) };
}
