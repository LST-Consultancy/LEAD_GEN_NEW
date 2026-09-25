import { z } from "zod";
import { parseOpportunityQuery, type SearchCriteria } from "./query-parser";

/**
 * An offering profile turned into a search. Pure and client-safe. The profile's intent phrases
 * route to the platforms that match them — buyer phrases to request platforms, job titles to job
 * boards, business categories to Maps — while its industries and company size are *fit*, left to
 * the ICP and never used as search filters: a filter rejects every post that does not state a
 * size, which is most of them.
 */
const list = (max: number, len = 160) => z.array(z.string().trim().min(2).max(len)).max(max).default([]);
export const offeringSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).default(""),
  services: list(10), technologies: list(15, 80),
  buyerPhrases: list(12, 200), jobTitles: list(12, 120), prospectCategories: list(5, 120),
  industries: list(10, 100), locations: list(10, 100),
  employeeMin: z.number().int().nonnegative().nullable().default(null), employeeMax: z.number().int().positive().nullable().default(null),
  negativeKeywords: list(20, 80), platforms: z.array(z.string().max(40)).max(14).default([]),
}).refine(o => o.services.length + o.technologies.length + o.buyerPhrases.length + o.jobTitles.length + o.prospectCategories.length > 0, "Describe the offering with at least one service, technology, buyer phrase, job title or business category.")
  .refine(o => o.employeeMin === null || o.employeeMax === null || o.employeeMin <= o.employeeMax, "The smallest company size must not exceed the largest.");
export type OfferingInput = z.infer<typeof offeringSchema>;

export const routingSchema = z.object({ offeringId: z.string().uuid().optional(), buyerPhrases: z.array(z.string()).max(12).default([]), jobTitles: z.array(z.string()).max(12).default([]), prospectCategories: z.array(z.string()).max(5).default([]) });
export type Routing = z.infer<typeof routingSchema>;

export type OfferingLike = Pick<OfferingInput, "name" | "services" | "technologies" | "buyerPhrases" | "jobTitles" | "prospectCategories" | "locations" | "negativeKeywords"> & { id?: string };

/** The search a profile produces: its query text, criteria and per-platform routing. */
export function offeringToSearch(o: OfferingLike): { query: string; criteria: SearchCriteria; routing: Routing } {
  const subject = [...o.services, ...o.technologies][0] ?? o.buyerPhrases[0] ?? o.jobTitles[0] ?? o.prospectCategories[0] ?? o.name;
  const query = `${subject}${o.locations.length ? ` in ${o.locations.join(", ")}` : ""}`;
  const parsed = parseOpportunityQuery(query);
  const criteria: SearchCriteria = {
    ...parsed,
    services: [...new Set([...o.services, ...parsed.services])].slice(0, 30),
    technologies: [...new Set([...o.technologies, ...parsed.technologies])].slice(0, 30),
    locations: o.locations.length ? o.locations.slice(0, 20) : parsed.locations,
    expandedTerms: [...new Set([...o.buyerPhrases, ...parsed.expandedTerms])].slice(0, 40),
    negativeKeywords: [...new Set([...o.negativeKeywords, ...parsed.negativeKeywords])].slice(0, 20),
    industries: [], employeeMin: null, employeeMax: null,
  };
  return { query, criteria, routing: { offeringId: o.id, buyerPhrases: o.buyerPhrases, jobTitles: o.jobTitles, prospectCategories: o.prospectCategories } };
}
