import "server-only";
import { providerJson } from "./http";
import { PartialDiscoveryError } from "./opportunity-source";
import type { ProviderConfig } from "./discovery";
import type { SearchCriteria } from "@/lib/opportunities/query-parser";
import type { SourceDocument } from "@/lib/opportunities/extractor";
import { mapLinkedInPost } from "@/lib/opportunities/linkedin-post";
import { webQueryTerms } from "@/lib/opportunities/web-queries";

export const LINKEDIN_POSTS_PROVIDER = "linkedin_posts";
// A third-party Apify actor, not a LinkedIn API. Its output format is not published, so mapLinkedInPost reads it tolerantly.
export const LINKEDIN_POSTS_ACTOR = "apimaestro~linkedin-posts-search-scraper-no-cookies";
const RUN_TIMEOUT_S = 120;

const dateFilter = (days: number) => (days <= 1 ? "past-24h" : days <= 7 ? "past-week" : "past-month");

export async function searchLinkedInPosts(workspaceId: string, config: ProviderConfig, query: SearchCriteria, key?: string): Promise<SourceDocument[]> {
  if (!key) throw new Error("The Apify API token is missing.");
  const records = new Map<string, SourceDocument>(); let returned = 0;
  for (const keyword of webQueryTerms(query, config.maxQueries)) {
    let data: unknown;
    try { data = await providerJson(workspaceId, LINKEDIN_POSTS_PROVIDER,
      `https://api.apify.com/v2/acts/${LINKEDIN_POSTS_ACTOR}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_S}`,
      { Authorization: `Bearer ${key}` },
      { keyword, sort_type: "date_posted", date_filter: dateFilter(query.dateRange.days), limit: config.postsPerQuery, page_number: 1 },
      { timeoutMs: (RUN_TIMEOUT_S + 15) * 1000 }); }
    catch (error) { if (records.size) throw new PartialDiscoveryError(error instanceof Error ? error.message : "LinkedIn post search failed.", [...records.values()]); throw error; }
    if (!Array.isArray(data)) throw new Error("The LinkedIn post source returned something other than a list of posts.");
    returned += data.length;
    for (const item of data) { const doc = mapLinkedInPost(item, LINKEDIN_POSTS_PROVIDER, keyword); if (doc) records.set(doc.externalId, doc); }
  }
  // Posts that arrive but cannot be read must not look like "no posts found".
  if (returned > 0 && records.size === 0) throw new Error(`The LinkedIn post source returned ${returned} posts in a format this app cannot read, so none were used. The scraper's output may have changed.`);
  return [...records.values()];
}

/** Checks the token against Apify's account endpoint, which is free, rather than paying for a scrape. */
export async function checkLinkedInPostsAccess(workspaceId: string, key?: string) {
  if (!key) return { ok: false, message: "Add your Apify API token first." };
  await providerJson(workspaceId, LINKEDIN_POSTS_PROVIDER, "https://api.apify.com/v2/users/me", { Authorization: `Bearer ${key}` });
  return { ok: true, message: "Apify accepted the token. No posts were scraped or charged by this test." };
}
