/**
 * Which discovery sources a watched search phrase runs on, from the kind of source it was written
 * for. Pure. A kind with no discovery source (a licensed dataset, an integration, manual entry)
 * cannot be watched automatically, and says so rather than silently never running.
 */
export const PHRASE_PROVIDERS: Record<string, string[]> = {
  JOB_BOARD: ["apify_linkedin_jobs", "apify_indeed", "apify_naukri", "adzuna", "greenhouse", "lever", "ashby"],
  PUBLIC_WEB: ["brave", "apify_google_search"],
  NEWS: ["brave", "apify_google_search"],
  SOCIAL_PUBLIC: ["linkedin_posts", "apify_reddit"],
  TENDER_PORTAL: ["apify_websites", "apify_google_search", "brave"],
  COMPANY_SITE: ["apify_websites"],
};
export const UNWATCHABLE_REASON = "Phrases for this kind of source are recorded for attribution, but no discovery source can run them on a schedule.";
export const providersForPhrase = (sourceKind: string, connected: string[]) => (PHRASE_PROVIDERS[sourceKind] ?? []).filter(p => connected.includes(p));
