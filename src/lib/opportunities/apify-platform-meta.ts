import { z } from "zod";

/** Client-safe facts about the Apify discovery platforms; the mappers live in `apify-platforms.ts`. */
export type ResultClass = "buying_request" | "hiring" | "business_prospect";
export const APIFY_PLATFORM_IDS = ["apify_linkedin_jobs", "apify_indeed", "apify_naukri", "apify_google_search", "apify_reddit", "apify_upwork", "apify_google_maps", "apify_websites"] as const;
export type ApifyPlatformId = typeof APIFY_PLATFORM_IDS[number];
export const isApifyPlatform = (id: string): id is ApifyPlatformId => (APIFY_PLATFORM_IDS as readonly string[]).includes(id);

const actorRef = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}[/~][a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/, "Use the Actor's username/name");
export const platformConfigSchema = z.object({
  actor: actorRef.optional(),
  maxQueries: z.number().int().min(1).max(5).default(2),
  maxItemsPerQuery: z.number().int().min(5).max(200).default(25),
  /** The most one search may spend on this platform; the run is told this as its charge limit. */
  maxUsdPerSearch: z.number().min(0.01).max(20).default(0.5),
  country: z.string().regex(/^[a-z]{2}$/).default("in"),
  location: z.string().trim().max(120).default(""),
  /** Google Maps only: the categories and area to list businesses for. */
  mapsQueries: z.array(z.string().trim().min(2).max(120)).max(5).default([]),
  /** Public websites only: the pages to read, e.g. a procurement or tenders page. */
  startUrls: z.array(z.string().url().max(500)).max(10).default([]),
});
export type PlatformConfig = z.infer<typeof platformConfigSchema>;


export const PLATFORM_META: Record<ApifyPlatformId, { name: string; actor: string; resultClass: ResultClass; priceNote: string }> = {
  apify_linkedin_jobs: { name: "LinkedIn jobs", actor: "curious_coder/linkedin-jobs-scraper", resultClass: "hiring", priceNote: "$0.002 per job listed (FREE tier)." },
  apify_indeed: { name: "Indeed", actor: "valig/indeed-jobs-scraper", resultClass: "hiring", priceNote: "$0.0001 per job plus $0.001 per run (FREE tier)." },
  apify_naukri: { name: "Naukri", actor: "muhammetakkurtt/naukri-job-scraper", resultClass: "hiring", priceNote: "$0.0015 per job plus $0.001 per run (FREE tier, search results only)." },
  apify_google_search: { name: "Google Search", actor: "apify/google-search-scraper", resultClass: "buying_request", priceNote: "$0.0045 per results page plus $0.001 per run (FREE tier)." },
  apify_reddit: { name: "Reddit", actor: "trudax/reddit-scraper-lite", resultClass: "buying_request", priceNote: "$0.004 per post plus $0.02 per run (FREE tier)." },
  apify_upwork: { name: "Upwork", actor: "neatrat/upwork-job-scraper", resultClass: "buying_request", priceNote: "About $0.0035 per job (FREE tier). The Actor lists two per-job events; whether both are charged is unconfirmed, so estimates assume both." },
  apify_google_maps: { name: "Google Maps", actor: "compass/crawler-google-places", resultClass: "business_prospect", priceNote: "$0.004 per place (FREE tier); contact scraping and filters are extra and not requested." },
  apify_websites: { name: "Public websites", actor: "apify/website-content-crawler", resultClass: "buying_request", priceNote: "Billed as Apify compute; pages are capped per run." },
};
