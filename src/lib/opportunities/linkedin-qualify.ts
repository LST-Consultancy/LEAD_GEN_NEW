import { extractOpportunity, plainText, type SourceDocument } from "./extractor";
import type { OpportunityType, SearchCriteria } from "./query-parser";

/**
 * Decides what one LinkedIn post is, before any buyer attribution. Pure and deterministic.
 *
 * Every rule that can set a post aside returns exactly one primary reason, checked in a fixed
 * order, so a post is counted once in the funnel however many rules it would fail. The phrase
 * that decided it is kept as evidence, so a person can see why without re-reading the post.
 */

export type PostKind = "buying" | "seller_promotion" | "job_seeker" | "internal_hiring" | "informational";
export type RejectReason =
  | "negative_keyword" | "not_relevant" | "outside_date_window" | "job_seeker" | "seller_promotion"
  | "internal_hiring" | "informational" | "filter_mismatch" | "type_mismatch" | "filter_unknown_strict" | "previously_removed";
export type ReviewReason = "ai_unavailable" | "buyer_unresolved" | "date_unknown" | "filter_unknown";
/** The order a review reason is reported in when several apply: the one a reviewer must act on first. */
export const REVIEW_ORDER: ReviewReason[] = ["ai_unavailable", "buyer_unresolved", "date_unknown", "filter_unknown"];

const excerpt = (text: string, m: RegExpExecArray | null) => {
  if (!m) return null;
  const start = Math.max(0, m.index - 60); const end = Math.min(text.length, m.index + m[0].length + 60);
  return `${start ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
};

// Someone looking for work. "Open to new opportunities" is a person, never a buyer.
const JOB_SEEKER = /#opentowork\b|\bopen to (?:work|new (?:roles|opportunities|positions|challenges))\b|\b(?:i am|i'm|i’m)\s+(?:currently\s+|actively\s+|now\s+)?(?:looking for|seeking|searching for|exploring)\s+(?:a\s+|my next\s+|new\s+)*(?:job|role|position|opportunit(?:y|ies)|full[- ]time|part[- ]time|contract (?:role|position)|challenge)s?\b|\blooking for (?:my next|a new) (?:role|job|opportunity|position|challenge)\b|\b(?:i was|i've been|i have been) (?:recently )?laid off\b/i;
// A seller advertising: a service, a free call, a portfolio. The commonest thing a buyer-phrased search returns.
const SELLER = /\b(?:we|i) (?:help|offer|provide|deliver|build|speciali[sz]e in|partner with)\b|\bour (?:services|team of|experts|consultants|clients|agency|portfolio)\b|\bdm (?:me|us) (?:for|to)\b|\b(?:hire|contact) us\b|\b(?:looking for|seeking|taking on|accepting|open to) (?:new |more )?(?:clients|customers|projects)\b|\bavailable for (?:new )?(?:projects|freelance|contract work|hire)\b|\bfree (?:consultation|audit|demo|assessment)\b|\bbook a (?:call|demo|meeting|consultation)\b|\blink in (?:bio|comments?)\b|\bwe(?:'re| are|’re) (?:a |an )?(?:certified|leading|trusted|award[- ]winning|official)\b|\bcertified (?:\w+ )?(?:partner|consultant)s?\b|\b(?:solution|implementation) partner for\b/i;
// The ask itself. Each alternative is how buyers actually write it.
const ASK = [
  /\b(?:looking for|seeking|searching for|in search of|in need of|need|needs|require|requires|looking to (?:hire|engage|partner with))\s+(?:an?\s+|some\s+|the\s+|reliable\s+|experienced\s+|good\s+)*(?:[\w/&.+-]+\s+){0,4}?(?:consultants?|consultancy|partners?|agenc(?:y|ies)|freelancers?|vendors?|contractors?|experts?|specialists?|firms?|developers?|dev team|development team|external team|outsourcing partner|implementers?|integrators?|provider)\b/i,
  /\b(?:can|could) (?:anyone|someone|you) (?:recommend|suggest|refer)\b|\bany (?:recommendations|suggestions|referrals)\b|\brecommendations? for (?:an?|some|good)\b|\bwho (?:can|could) help (?:us|me)\b|\bdoes anyone know (?:an?|any|of|a good)\b/i,
  /\bneeds? (?:some |urgent )?help (?:with|on|implementing|integrating|setting up|migrating)\b|\bneeds? support (?:with|for|on)\b/i,
  /\b(?:rfp|rfq|request for (?:proposals?|quotations?|information))\b|\binvit(?:e|es|ing) (?:proposals|bids|quotes|quotations)\b|\btender\b/i,
  /\b(?:hiring|looking to hire|want to hire|need to hire)\s+(?:an?\s+)?(?:[\w/.+-]+\s+){0,3}?(?:freelancers?|contractors?|agenc(?:y|ies)|consultants?|consultancy|firm|external team)\b/i,
];
// A rhetorical question in an advert: "Looking for a NetSuite partner? We help…"
const RHETORICAL = /\b(?:looking for|need|struggling with|searching for)[^.?!\n]{0,80}\?\s*(?:we|our|i|let us|look no further|contact|dm)\b/i;
const FIRST_PERSON = /\b(?:we|i|our (?:team|company|client|firm|business|organi[sz]ation))(?:'re|’re| are|'m|’m| am| is)?\s+(?:currently\s+|actively\s+|urgently\s+|now\s+)?(?:looking|seeking|searching|in need|need|require|want|hiring|planning)\b|\b(?:can|could) (?:anyone|someone) (?:recommend|suggest)\b/i;
// An employee vacancy, as opposed to engaging an outside provider.
const HIRING = /\b(?:we(?:'re| are|’re) hiring|#hiring|join our (?:team|company)|job opening|open (?:position|role)|apply (?:now|here|via|at|through)|send (?:your )?(?:cv|resume)|full[- ]time (?:role|position)|years of experience|job description|\bctc\b|salary|on-?site role|permanent role|immediate joiner)\b/i;
const EXTERNAL = /\b(?:freelancers?|contractors?|agenc(?:y|ies)|consultants?|consultancy|partners?|vendors?|outsourc\w*|external|contract basis|project basis|fixed[- ]price|rfp|proposals?)\b/i;

export function classifyPost(text: string): { kind: PostKind; evidence: string | null } {
  const seeker = JOB_SEEKER.exec(text);
  if (seeker) return { kind: "job_seeker", evidence: excerpt(text, seeker) };
  const ask = ASK.map(re => re.exec(text)).find(Boolean) ?? null;
  const seller = SELLER.exec(text);
  const rhetorical = RHETORICAL.exec(text);
  // A first-person ask outweighs a seller phrase: a buyer can still write "we help our customers".
  if (seller && (rhetorical || !ask || !FIRST_PERSON.test(text))) return { kind: "seller_promotion", evidence: excerpt(text, rhetorical ?? seller) };
  const hiring = HIRING.exec(text);
  // "Hiring" alone is not a verdict: hiring an agency or a freelancer is buying a service.
  if (hiring && !EXTERNAL.test(text)) return { kind: "internal_hiring", evidence: excerpt(text, hiring) };
  if (ask) return { kind: "buying", evidence: excerpt(text, ask) };
  if (hiring) return { kind: "internal_hiring", evidence: excerpt(text, hiring) };
  return { kind: "informational", evidence: null };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive, with "full-stack" = "full stack" and an optional plural. */
export function matchTerms(text: string, terms: string[]): string[] {
  return terms.filter(t => {
    const pattern = t.trim().split(/[\s-]+/).map(escape).join("[\\s-]*");
    return pattern && new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?:s|es)?(?![\\p{L}\\p{N}])`, "iu").test(text);
  });
}

// Types that say what work is wanted. PROJECT, CONSULTING, OUTSOURCING and RFP describe how a buyer
// asks ("a consultant", "an RFP"), not what for, so a post using them does not differ from any search.
const SPECIFIC_TYPES: OpportunityType[] = ["IMPLEMENTATION", "INTEGRATION", "MIGRATION", "STAFF_AUGMENTATION", "DIGITAL_TRANSFORMATION"];

export type FilterCheck = { field: "employees" | "location" | "industry"; wanted: string; state: "match" | "mismatch" | "unknown"; value: string | null };
/**
 * Each explicit filter as match, mismatch or unknown. A LinkedIn post rarely states company size,
 * industry or country, and "not stated" must stay unknown rather than be read as either answer.
 */
export function checkFilters(doc: SourceDocument, criteria: SearchCriteria): FilterCheck[] {
  const out: FilterCheck[] = [];
  const employees = doc.company.employees;
  if (criteria.employeeMin !== null || criteria.employeeMax !== null) {
    const wanted = `${criteria.employeeMin ?? 0}–${criteria.employeeMax ?? "any"} employees`;
    if (employees == null) out.push({ field: "employees", wanted, state: "unknown", value: null });
    else out.push({ field: "employees", wanted, state: (criteria.employeeMin === null || employees >= criteria.employeeMin) && (criteria.employeeMax === null || employees <= criteria.employeeMax) ? "match" : "mismatch", value: String(employees) });
  }
  if (criteria.locations.length) {
    const known = [doc.company.country, doc.company.location, doc.location].filter((v): v is string => !!v && v.trim() !== "" && v !== "Unknown");
    const wanted = criteria.locations.join(" or ");
    if (!known.length) out.push({ field: "location", wanted, state: "unknown", value: null });
    else out.push({ field: "location", wanted, state: criteria.locations.some(l => known.join(" ").toLowerCase().includes(l.toLowerCase())) ? "match" : "mismatch", value: known.join(", ") });
  }
  if (criteria.industries.length) {
    const wanted = criteria.industries.join(" or ");
    const industry = doc.company.industry?.trim();
    if (!industry) out.push({ field: "industry", wanted, state: "unknown", value: null });
    else out.push({ field: "industry", wanted, state: criteria.industries.some(i => industry.toLowerCase().includes(i.toLowerCase())) ? "match" : "mismatch", value: industry });
  }
  return out;
}

export type PostDecision =
  | { outcome: "rejected"; reason: RejectReason; kind: PostKind | null; evidence: PostEvidence }
  | { outcome: "candidate"; kind: "buying"; review: ReviewReason[]; evidence: PostEvidence };
export type PostEvidence = { quote: string | null; matchedTerms: string[]; filters: FilterCheck[]; types: OpportunityType[]; postedAt: string | null; detail?: string };

/** Everything decidable from the post alone. Attribution and storage happen after this. */
export function decidePost(doc: SourceDocument, criteria: SearchCriteria, ctx: { terms: string[]; now: Date; strict: boolean }): PostDecision {
  const text = plainText(`${doc.title}. ${doc.description}`);
  const lower = text.toLowerCase();
  const extracted = extractOpportunity(doc, criteria);
  const matchedTerms = matchTerms(text, ctx.terms);
  const filters = checkFilters(doc, criteria);
  const postedAt = extracted.postedAt;
  const base = { matchedTerms, filters, types: extracted.opportunityTypes, postedAt };
  const reject = (reason: RejectReason, kind: PostKind | null, quote: string | null, detail?: string): PostDecision => ({ outcome: "rejected", reason, kind, evidence: { ...base, quote, ...(detail ? { detail } : {}) } });

  const negative = criteria.negativeKeywords.find(k => lower.includes(k.toLowerCase()));
  if (negative) return reject("negative_keyword", null, null, `Contains excluded term "${negative}".`);
  if (!matchedTerms.length) return reject("not_relevant", null, null, `Does not mention ${ctx.terms.slice(0, 4).join(", ")}.`);
  if (postedAt) {
    const t = new Date(postedAt).getTime();
    if (t < ctx.now.getTime() - criteria.dateRange.days * 86400000) return reject("outside_date_window", null, null, `Posted ${postedAt.slice(0, 10)}, before the ${criteria.dateRange.days}-day window.`);
  }
  const { kind, evidence: quote } = classifyPost(text);
  if (kind !== "buying") return reject(kind, kind, quote);

  const wanted = criteria.opportunityTypes.filter(t => SPECIFIC_TYPES.includes(t));
  const stated = extracted.opportunityTypes.filter(t => SPECIFIC_TYPES.includes(t));
  const review: ReviewReason[] = [];
  const typeDiffers = wanted.length > 0 && stated.length > 0 && !stated.some(t => wanted.includes(t));
  const mismatch = filters.find(f => f.state === "mismatch");
  if (mismatch) return reject("filter_mismatch", kind, quote, `${mismatch.field}: ${mismatch.value}, wanted ${mismatch.wanted}.`);
  const unknown = filters.filter(f => f.state === "unknown");
  if (ctx.strict && typeDiffers) return reject("type_mismatch", kind, quote, `Asks for ${stated.join(", ").toLowerCase()}, not ${wanted.join(", ").toLowerCase()}.`);
  if (ctx.strict && unknown.length) return reject("filter_unknown_strict", kind, quote, `Strict filters: ${unknown.map(f => f.field).join(", ")} not stated.`);
  if (!postedAt) review.push("date_unknown");
  if (unknown.length) review.push("filter_unknown");
  // Outside strict mode a different kind of related work ("NetSuite integration" on an
  // implementation search) is kept, with the difference recorded rather than hidden.
  return { outcome: "candidate", kind: "buying", review, evidence: { ...base, quote, ...(typeDiffers ? { detail: `Asks for ${stated.join(", ").toLowerCase()}; the search named ${wanted.join(", ").toLowerCase()}.` } : {}) } };
}

// Headlines that name an employer who is not the one buying.
const NOT_A_BUYER_HEADLINE = /\b(?:recruit\w*|talent|staffing|headhunt\w*|freelanc\w*|self[- ]employed|stealth|open to work|looking for|seeking|student|consultant|consulting|agency)\b/i;
/**
 * The employer in an author's headline ("CFO at Northwind Traders"), offered to a reviewer as a
 * suggestion. It never qualifies a post on its own: the author may be asking for someone else.
 */
export function suggestBuyerFromHeadline(headline: unknown): string | null {
  if (typeof headline !== "string" || NOT_A_BUYER_HEADLINE.test(headline)) return null;
  const m = /(?:\bat\b|@)\s+([A-Z0-9][\w&.'’-]*(?:\s+(?:[A-Z0-9&][\w&.'’-]*|of|and|for|the)){0,5})/.exec(headline);
  const name = m?.[1]?.replace(/\s+(?:of|and|for|the)$/i, "").trim();
  return name && name.length >= 2 && name.length <= 80 ? name : null;
}
