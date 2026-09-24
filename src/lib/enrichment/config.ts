import { z } from "zod";

/**
 * Apify enrichment settings. Every Actor reference and limit is configurable; the defaults are the
 * Actors whose input schemas and example outputs were checked on 2026-09-24 (see
 * docs/apify-enrichment.md). A custom Actor must accept the same input and produce the same
 * fields, or its results will not map — nothing here guesses a different Actor's output.
 */
const actorRef = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}[/~][a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/, "Use the Actor's username/name, e.g. apify/google-search-scraper");

export const DEFAULT_ACTORS = {
  search: "apify/google-search-scraper",
  company: "harvestapi/linkedin-company",
  employees: "harvestapi/linkedin-company-employees",
  website: "automation-lab/website-contact-finder",
  verify: "bounceverify/bounceverify-email-verifier",
} as const;

/** The two verification output formats this app can read. Each is documented by its Actor. */
export const VERIFIER_FORMATS = ["bounceverify", "michael_g"] as const;
export const EMPLOYEE_MODES = ["Short ($4 per 1k)", "Full ($8 per 1k)", "Full + email search ($12 per 1k)"] as const;

export const enrichmentConfigSchema = z.object({
  actors: z.object({ search: actorRef.default(DEFAULT_ACTORS.search), company: actorRef.default(DEFAULT_ACTORS.company), employees: actorRef.default(DEFAULT_ACTORS.employees), website: actorRef.default(DEFAULT_ACTORS.website), verify: actorRef.default(DEFAULT_ACTORS.verify) }).default(DEFAULT_ACTORS),
  verifierFormat: z.enum(VERIFIER_FORMATS).default("bounceverify"),
  // Full mode is needed to tell a current employee from a former one: only it returns experience with end dates.
  employeeMode: z.enum(EMPLOYEE_MODES).default("Full ($8 per 1k)"),
  peoplePerCompany: z.number().int().min(1).max(50).default(10),
  websitePages: z.number().int().min(1).max(50).default(10),
  emailChecksPerRun: z.number().int().min(1).max(200).default(20),
  verifyCacheDays: z.number().int().min(1).max(365).default(30),
  freshDays: z.number().int().min(1).max(365).default(30),
  maxUsdPerRun: z.number().min(0.05).max(50).default(1),
  runTimeoutSec: z.number().int().min(60).max(600).default(240),
  searchCountry: z.string().regex(/^[a-z]{2}$/).optional(),
  autoEnrich: z.object({ enabled: z.boolean().default(false), minIntent: z.number().int().min(0).max(100).default(60), maxPerDay: z.number().int().min(1).max(100).default(5) }).default({ enabled: false, minIntent: 60, maxPerDay: 5 }),
});
export type EnrichmentConfig = z.infer<typeof enrichmentConfigSchema>;
export const parseEnrichmentConfig = (raw: unknown): EnrichmentConfig => {
  const r = enrichmentConfigSchema.safeParse(raw ?? {});
  return r.success ? r.data : enrichmentConfigSchema.parse({});
};

/**
 * Listed per-event prices on each default Actor's Apify page, FREE tier, 2026-09-24. Used only to
 * *estimate* before a run and to decide whether it fits the budget; the figure shown after a run
 * is what Apify reports. Higher Apify plans are cheaper; an unknown custom Actor is estimated at
 * the default Actor's price and says so.
 */
export const LISTED_PRICES_USD = {
  search: { start: 0.001, perPage: 0.0045 },
  company: { start: 0.00005, perCompany: 0.004 },
  employees: { start: 0.02, perProfile: { "Short ($4 per 1k)": 0.003, "Full ($8 per 1k)": 0.008, "Full + email search ($12 per 1k)": 0.012 } },
  website: { start: 0.035, perPage: 0.001 },
  verify: { start: 0, perEmail: 0.00089 },
} as const;
export const PRICE_NOTE = "Estimated from the Actors' listed FREE-tier prices (Apify, September 2026). Your plan may be cheaper; the figure after a run is what Apify reports.";

export const estimate = {
  search: (queries: number) => LISTED_PRICES_USD.search.start + queries * LISTED_PRICES_USD.search.perPage,
  company: (companies: number) => LISTED_PRICES_USD.company.start + companies * LISTED_PRICES_USD.company.perCompany,
  employees: (profiles: number, mode: EnrichmentConfig["employeeMode"]) => LISTED_PRICES_USD.employees.start + profiles * LISTED_PRICES_USD.employees.perProfile[mode],
  website: (pages: number) => LISTED_PRICES_USD.website.start + pages * LISTED_PRICES_USD.website.perPage,
  // michael.g's listed FREE-tier price is $0.10 per email; BounceVerify's is $0.00089.
  verify: (emails: number, format: EnrichmentConfig["verifierFormat"]) => emails * (format === "michael_g" ? 0.1 : LISTED_PRICES_USD.verify.perEmail),
};
export const money = (usd: number) => `$${usd < 0.01 && usd > 0 ? usd.toFixed(3) : usd.toFixed(2)}`;
