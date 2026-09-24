import { z } from "zod";
import type { SearchCriteria } from "./query-parser";

/**
 * What a LinkedIn discovery run searches for, and how far it is allowed to go.
 *
 * Shared by the search screen (to preview and edit the plan) and the worker (to run it), so the
 * queries a person approves are the queries that are sent. No database or server imports.
 */

// ── Provider contract ────────────────────────────────────────────────────────────────────────────
// From the actor's published input schema (apimaestro/linkedin-posts-search-scraper-no-cookies),
// checked 2026-09-24: `date_filter` is one of "", past-1h, past-24h, past-week, past-month;
// `limit` is 1–50 per page; `page_number` paginates manually; `total_posts` switches to automatic
// pagination and *overrides* page_number, so this app never sends it. Quotes force exact match and
// OR / NOT / parentheses are LinkedIn's own search operators.
export const LINKEDIN_PAGE_MAX = 50;
/** The actor's listed price on its Apify page on 2026-09-24. Your plan's rate may differ. */
export const APIFY_USD_PER_1000_POSTS = 5;
export const APIFY_PRICE_NOTE = "at the actor's listed $5 per 1,000 posts (Apify page, September 2026); your plan's rate may differ";

export type LinkedInDateFilter = "" | "past-24h" | "past-week" | "past-month";
/**
 * The narrowest provider filter that still contains the whole requested window. Posts are then
 * checked against the exact window locally. Beyond a month LinkedIn has no filter, so the run
 * goes unfiltered and newest-first, which lets a query stop once it walks past the window.
 */
export function linkedInDateWindow(days: number): { filter: LinkedInDateFilter; sort: "relevance" | "date_posted"; note: string | null } {
  if (days <= 1) return { filter: "past-24h", sort: "relevance", note: null };
  if (days <= 7) return { filter: "past-week", sort: "relevance", note: days < 7 ? `LinkedIn filters by past week; posts older than ${days} days are discarded here.` : null };
  if (days <= 30) return { filter: "past-month", sort: "relevance", note: days < 30 ? `LinkedIn filters by past month; posts older than ${days} days are discarded here.` : null };
  return { filter: "", sort: "date_posted", note: `LinkedIn's search can filter to the past month at most. For ${days} days this run searches without a date filter, newest first, and discards posts older than ${days} days. LinkedIn does not reliably return older posts, so coverage beyond the past month is not guaranteed.` };
}

// ── Run options ──────────────────────────────────────────────────────────────────────────────────
export const DEPTHS = {
  quick: { maxQueries: 4, maxPagesPerQuery: 1, postsPerPage: 25, maxPosts: 100, targetQualified: 5, maxRuntimeSec: 240 },
  standard: { maxQueries: 8, maxPagesPerQuery: 2, postsPerPage: 25, maxPosts: 200, targetQualified: 10, maxRuntimeSec: 480 },
  deep: { maxQueries: 16, maxPagesPerQuery: 4, postsPerPage: 50, maxPosts: 500, targetQualified: 25, maxRuntimeSec: 780 },
} as const;
export type Depth = keyof typeof DEPTHS | "custom";
export const DEFAULT_DEPTH = "standard" as const;
type Limits = { maxQueries: number; maxPagesPerQuery: number; postsPerPage: number; maxPosts: number; targetQualified: number; maxRuntimeSec: number };

export const discoveryOptionsSchema = z.object({
  depth: z.enum(["quick", "standard", "deep", "custom"]).default(DEFAULT_DEPTH),
  maxQueries: z.number().int().min(1).max(24).optional(),
  maxPagesPerQuery: z.number().int().min(1).max(10).optional(),
  postsPerPage: z.number().int().min(10).max(LINKEDIN_PAGE_MAX).optional(),
  maxPosts: z.number().int().min(10).max(5000).optional(),
  targetQualified: z.number().int().min(1).max(200).optional(),
  // The worker's job timeout is 15 minutes; leave room to write the result.
  maxRuntimeSec: z.number().int().min(60).max(780).optional(),
  /** Unknown company size, location or industry rejects instead of going to review. */
  strictFilters: z.boolean().default(false),
  /** A person's edit of the planned queries. Replaces the generated plan when present. */
  queries: z.array(z.string().trim().min(3).max(300)).max(24).optional(),
});
export type DiscoveryOptions = z.infer<typeof discoveryOptionsSchema>;
export type ResolvedOptions = { depth: Depth; maxQueries: number; maxPagesPerQuery: number; postsPerPage: number; maxPosts: number; targetQualified: number; maxRuntimeSec: number; strictFilters: boolean; queries?: string[]; cappedBy: number | null };

/** Tolerant: a bad saved option falls back to the default rather than breaking a watch. */
export function parseDiscoveryOptions(raw: unknown): DiscoveryOptions {
  const parsed = discoveryOptionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : discoveryOptionsSchema.parse({});
}

/** Preset values, overridden only in custom depth, then capped by the workspace's per-search post ceiling. */
export function resolveOptions(raw: unknown, workspaceMaxPosts: number): ResolvedOptions {
  const o = parseDiscoveryOptions(raw);
  const base: Limits = DEPTHS[o.depth === "custom" ? DEFAULT_DEPTH : o.depth];
  const pick = (k: keyof Limits) => (o.depth === "custom" ? (o[k] ?? base[k]) : base[k]);
  const wanted = pick("maxPosts");
  return {
    depth: o.depth, maxQueries: pick("maxQueries"), maxPagesPerQuery: pick("maxPagesPerQuery"), postsPerPage: pick("postsPerPage"),
    maxPosts: Math.min(wanted, workspaceMaxPosts), targetQualified: pick("targetQualified"), maxRuntimeSec: pick("maxRuntimeSec"),
    strictFilters: o.strictFilters, queries: o.queries?.length ? o.queries : undefined, cappedBy: wanted > workspaceMaxPosts ? workspaceMaxPosts : null,
  };
}

export const estimatedCostUsd = (posts: number) => Math.round(posts * APIFY_USD_PER_1000_POSTS / 10) / 100;

// ── Subjects ─────────────────────────────────────────────────────────────────────────────────────
// Only true synonyms of the subject. "ERP" is not an alias of NetSuite: it would find every ERP project.
const ALIASES: Record<string, string[]> = {
  NetSuite: ["Oracle NetSuite", "SuiteScript"],
  Salesforce: ["Salesforce CRM"],
  HubSpot: ["HubSpot CRM"],
  SAP: ["SAP S/4HANA"],
  "Full-stack development": ["MERN stack", "web application"],
};
// The parser names its full-stack pack "Full-stack development"; people write "full stack".
const SEARCH_NAME: Record<string, string> = { "Full-stack development": "full stack" };
// Words that describe the ask, not the subject. Stripped to find the subject of an unrecognised query.
const FILLER = new Set(["looking", "for", "a", "an", "the", "partner", "partners", "opportunities", "opportunity", "companies", "company", "services", "service", "need", "needs", "needed", "urgently", "urgent", "in", "us", "usa", "uk", "uae", "india", "from", "with", "and", "or", "of", "to", "help", "consultant", "consultants", "consulting", "agency", "agencies", "vendor", "vendors", "freelancer", "freelancers", "rfp", "rfps", "implementation", "implementations", "integration", "integrations", "migration", "migrations", "customization", "customisation", "development", "project", "projects", "requirement", "requirements", "expert", "experts", "support", "last", "past", "days", "within", "employees", "people", "staff", "hiring", "developer", "developers", "work", "job", "jobs", "we", "our", "seeking", "want", "find", "me"]);
const ACTION_WORDS = ["implementation", "integration", "migration", "customization", "consulting", "support"] as const;

export type Subject = { term: string; alias: boolean };
/** Every service and technology the query names, each with its aliases after it. Capped so aliases cannot crowd out subjects. */
export function planSubjects(criteria: Pick<SearchCriteria, "services" | "technologies">): Subject[] {
  const out: Subject[] = []; const seen = new Set<string>();
  const add = (term: string, alias: boolean) => { const k = term.toLowerCase(); if (term.trim().length >= 2 && !seen.has(k)) { seen.add(k); out.push({ term: term.trim(), alias }); } };
  for (const t of criteria.technologies) add(SEARCH_NAME[t] ?? t, false);
  if (!criteria.technologies.length) for (const s of criteria.services) { const core = coreSubject(s); if (core) add(core, false); }
  for (const t of criteria.technologies) for (const a of ALIASES[t] ?? []) add(a, true);
  return out.slice(0, 8);
}
/** "Web Application Development" → "Web Application"; "Odoo implementation in US companies" → "Odoo". */
export function coreSubject(text: string) {
  const words = text.replace(/[^\p{L}\p{N}+#./ -]/gu, " ").split(/\s+/).filter(Boolean);
  const kept = words.filter(w => !FILLER.has(w.toLowerCase()) && !/^\d+$/.test(w));
  return kept.slice(0, 4).join(" ");
}
/** The kinds of work asked for, in the words used in queries. */
export function planActions(criteria: Pick<SearchCriteria, "services">, query = ""): string[] {
  const text = `${criteria.services.join(" ")} ${query}`.toLowerCase();
  const found = ACTION_WORDS.filter(a => text.includes(a.slice(0, 7)));
  return found.length ? [...found] : ["implementation", "integration", "project"];
}

// ── Buyer-intent expressions ─────────────────────────────────────────────────────────────────────
const quote = (s: string) => `"${s.replaceAll('"', "")}"`;
export const INTENTS = [
  { id: "looking_for", label: "Looking for a consultant or partner", build: (s: string) => `${quote(s)} ("looking for" OR "seeking" OR "searching for") (consultant OR partner OR "implementation partner")` },
  { id: "need_help", label: "Need help with an integration or project", build: (s: string, actions: string[]) => `${quote(s)} ("need help" OR "needs help" OR "help with" OR "need support") (${actions.slice(0, 3).join(" OR ")})` },
  { id: "recommend", label: "Can anyone recommend an agency or freelancer", build: (s: string) => `${quote(s)} ("can anyone recommend" OR "any recommendations" OR "recommend a" OR "suggestions for") (agency OR freelancer OR consultant OR partner)` },
  { id: "vendor", label: "Seeking a vendor or external team", build: (s: string) => `${quote(s)} ("looking for" OR seeking OR need) (vendor OR "development team" OR "external team" OR "outsourcing partner")` },
  { id: "rfp", label: "RFP or request for proposal", build: (s: string) => `${quote(s)} (RFP OR "request for proposal" OR "request for proposals" OR tender)` },
  { id: "hire_external", label: "Hiring a freelancer, contractor or agency", build: (s: string) => `${quote(s)} (hiring OR "looking to hire" OR "want to hire") (freelancer OR contractor OR agency OR consultant)` },
] as const;
export type IntentId = typeof INTENTS[number]["id"];

export type PlannedQuery = { keyword: string; subject: string | null; intent: IntentId | "edited"; alias: boolean };

/**
 * Subjects × intents, walked diagonally: query k takes subject k mod S and intent k mod I (moving
 * to the next unused intent on a collision), so the first N queries cover as many subjects *and*
 * as many intent expressions as N allows. Primary subjects appear twice in the rotation when
 * aliases exist, so an alias never gets more queries than the thing it is an alias of. The old
 * planner put four fixed templates for the first subject ahead of everything else, so at its
 * default of three queries no other subject or expanded term was ever searched.
 */
export function planLinkedInQueries(criteria: SearchCriteria, maxQueries: number, query = ""): PlannedQuery[] {
  const subjects = planSubjects(criteria);
  if (!subjects.length || maxQueries < 1) return [];
  const primary = subjects.filter(s => !s.alias); const aliases = subjects.filter(s => s.alias);
  const rotation = primary.length && aliases.length ? [...primary, ...aliases, ...primary] : subjects;
  const actions = planActions(criteria, query);
  const not = criteria.negativeKeywords.map(k => ` NOT ${quote(k)}`).join("");
  const out: PlannedQuery[] = []; const seen = new Set<string>();
  const limit = Math.min(maxQueries, subjects.length * INTENTS.length);
  for (let k = 0; out.length < limit && k < rotation.length * INTENTS.length * 2; k++) {
    const s = rotation[k % rotation.length];
    for (let shift = 0; shift < INTENTS.length; shift++) {
      const intent = INTENTS[(k + shift) % INTENTS.length];
      const keyword = `${intent.build(s.term, actions)}${not}`;
      if (!seen.has(keyword)) { seen.add(keyword); out.push({ keyword, subject: s.term, intent: intent.id, alias: s.alias }); break; }
    }
  }
  return out;
}

/** The plan to run: a person's edited list wins, verbatim, over the generated one. */
export function effectivePlan(criteria: SearchCriteria, options: Pick<ResolvedOptions, "maxQueries" | "queries">, query = ""): PlannedQuery[] {
  if (options.queries?.length) return [...new Set(options.queries)].slice(0, 24).map(keyword => ({ keyword, subject: null, intent: "edited" as const, alias: false }));
  return planLinkedInQueries(criteria, options.maxQueries, query);
}

/** Words that make a post about this search, for the relevance check. Same subjects the queries use. */
export function relevanceTerms(criteria: SearchCriteria): string[] {
  const terms = new Set<string>();
  for (const s of planSubjects(criteria)) terms.add(s.term);
  for (const t of criteria.technologies) terms.add(SEARCH_NAME[t] ?? t);
  return [...terms];
}
