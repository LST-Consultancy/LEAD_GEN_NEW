import type { SearchCriteria } from "./query-parser";

/**
 * What the public-web source actually sends, shown on the search screen before it runs.
 * Phrased the way a buyer writes, because a bare technology name mostly returns the people selling it.
 */
export function webQueryTerms(criteria: SearchCriteria, maxQueries: number): string[] {
  const subject = criteria.services[0] ?? criteria.technologies[0] ?? criteria.expandedTerms[0];
  if (!subject) return [];
  const buyerPhrased = [`"looking for" ${subject} partner`, `${subject} RFP`, `${subject} "request for proposal"`, `"we are looking for" ${subject}`];
  return [...new Set([...buyerPhrased, ...criteria.expandedTerms])].slice(0, Math.max(0, maxQueries));
}
