/**
 * Which real company an opportunity's buyer is. Pure and deterministic: every candidate is scored
 * from evidence that can be shown, and a name match alone can never resolve a company — plenty of
 * firms share a name, and the first search result is often a directory or a namesake.
 */

export type SourceLike = { sourceUrl: string; title: string; description: string; rawReference?: unknown };
export type CompanyLike = { name: string; domain?: string | null; website?: string | null; linkedinUrl?: string | null; country?: string | null; city?: string | null };

// ── Hosts ────────────────────────────────────────────────────────────────────────────────────────
// Sites that describe or list other companies. Their host is never the buyer's own website.
const NOT_A_COMPANY_SITE = ["linkedin.com", "lnkd.in", "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com", "wikipedia.org", "crunchbase.com", "zaubacorp.com", "tofler.in", "indiamart.com", "justdial.com", "glassdoor.com", "glassdoor.co.in", "indeed.com", "naukri.com", "ambitionbox.com", "zoominfo.com", "apollo.io", "rocketreach.co", "dnb.com", "bloomberg.com", "clutch.co", "goodfirms.co", "google.com", "bit.ly", "medium.com", "github.com", "quora.com", "reddit.com", "yelp.com", "trustpilot.com", "g2.com", "capterra.com", "owler.com", "signalhire.com", "lusha.com", "companieshouse.gov.uk", "opencorporates.com", "mca.gov.in", "falconebiz.com", "instafinancials.com"];
const matchesHost = (host: string, list: string[]) => list.some(h => host === h || host.endsWith(`.${h}`));

/**
 * A hostname this app is willing to hand to an Actor as a website to crawl. The crawl runs on
 * Apify, not here, but a scraped or pasted value is still refused when it names a private network.
 */
export function safePublicHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host: string;
  try { host = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase(); } catch { return null; }
  host = host.replace(/\.$/, "");
  if (!host.includes(".") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host === "localhost") return null;
  if (/\.(local|localhost|internal|lan|home|corp|intranet|arpa)$/.test(host)) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}
/** "jobs.netflix.com" → "netflix.com": the company's site, not a careers subdomain. */
export function companyDomain(raw: string | null | undefined): string | null {
  const host = safePublicHost(raw);
  if (!host) return null;
  return host.replace(/^(?:www\d?|jobs|careers|career|about|en|m|web|info)\./, "");
}
export const isCompanySite = (host: string) => !matchesHost(host, NOT_A_COMPANY_SITE);

/** A LinkedIn company page as one canonical URL, or null. A /posts/ or /in/ link is not a company. */
export function linkedInCompanyUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!(u.hostname === "linkedin.com" || u.hostname.endsWith(".linkedin.com"))) return null;
    const m = /^\/(?:company|school|showcase)\/([^/?#]+)/.exec(u.pathname);
    return m ? `https://www.linkedin.com/company/${decodeURIComponent(m[1]).toLowerCase()}` : null;
  } catch { return null; }
}

// ── Names ────────────────────────────────────────────────────────────────────────────────────────
const LEGAL = /\b(?:llp|llc|l\.l\.p\.?|pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|corp\.?|corporation|co\.?|company|gmbh|plc|pte|sa|bv|ag|opc)\b/g;
export const nameKey = (name: string) => name.toLowerCase().replace(/\(.*?\)/g, " ").replace(LEGAL, " ").replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (name: string) => new Set(nameKey(name).split(" ").filter(t => t.length > 1));
export function nameSimilarity(a: string, b: string): "exact" | "contains" | "partial" | "different" {
  const ka = nameKey(a); const kb = nameKey(b);
  if (!ka || !kb) return "different";
  if (ka === kb) return "exact";
  if ((ka.length >= 5 && kb.includes(ka)) || (kb.length >= 5 && ka.includes(kb))) return "contains";
  const ta = tokens(a); const tb = tokens(b);
  const shared = [...ta].filter(t => tb.has(t)).length;
  return shared / Math.max(ta.size, tb.size) >= 0.6 ? "partial" : "different";
}

// ── Evidence already collected ───────────────────────────────────────────────────────────────────
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const BARE_DOMAIN_RE = /\b(?:www\.)?[a-z0-9][a-z0-9-]{1,62}\.(?:com|in|co\.in|io|ai|net|org|co|tech|biz|us|uk|co\.uk|de|sg|ae)\b/gi;
/** Websites and LinkedIn company pages written in the opportunity's own sources. */
export function evidenceLinks(sources: SourceLike[]) {
  const websites = new Map<string, string>(); const linkedin = new Map<string, string>();
  for (const s of sources) {
    const text = `${s.title}\n${s.description}`;
    for (const raw of [...(text.match(URL_RE) ?? []), ...(text.match(BARE_DOMAIN_RE) ?? [])]) {
      const li = linkedInCompanyUrl(raw.startsWith("http") ? raw : `https://${raw}`);
      if (li) { linkedin.set(li, s.sourceUrl); continue; }
      const d = companyDomain(raw);
      if (d && isCompanySite(d)) websites.set(d, s.sourceUrl);
    }
  }
  return { websites: [...websites.entries()].map(([domain, from]) => ({ domain, from })), linkedin: [...linkedin.entries()].map(([url, from]) => ({ url, from })) };
}

// ── Search results (apify/google-search-scraper) ────────────────────────────────────────────────
export type SearchHit = { url: string; title: string; description: string; query: string };
/** One item per search page: `{ searchQuery: { term }, organicResults: [{ title, url, description }] }`. */
export function parseSearchItems(items: unknown[]): SearchHit[] {
  const out: SearchHit[] = [];
  for (const item of items) {
    const r = (item ?? {}) as { searchQuery?: { term?: unknown }; organicResults?: unknown };
    const query = typeof r.searchQuery?.term === "string" ? r.searchQuery.term : "";
    for (const o of Array.isArray(r.organicResults) ? r.organicResults : []) {
      const x = (o ?? {}) as Record<string, unknown>;
      if (typeof x.url === "string") out.push({ url: x.url, title: typeof x.title === "string" ? x.title : "", description: typeof x.description === "string" ? x.description : "", query });
    }
  }
  return out;
}
export const searchQueriesFor = (company: CompanyLike) => {
  const name = company.name.replace(/["\\]/g, "").replace(/\(.*?\)/g, "").trim();
  return [`"${name}" official website`, `"${name}" linkedin company`];
};
/** What the search suggests: LinkedIn company pages, and websites whose result names the company. */
export function searchCandidates(hits: SearchHit[], name: string) {
  const linkedin = new Map<string, SearchHit>(); const websites = new Map<string, SearchHit>();
  for (const h of hits) {
    const li = linkedInCompanyUrl(h.url);
    if (li) { if (!linkedin.has(li)) linkedin.set(li, h); continue; }
    const d = companyDomain(h.url);
    if (d && isCompanySite(d) && nameSimilarity(h.title.split(/[|\-–—:]/)[0] ?? "", name) !== "different" && !websites.has(d)) websites.set(d, h);
  }
  return { linkedin: [...linkedin.entries()].map(([url, hit]) => ({ url, hit })), websites: [...websites.entries()].map(([domain, hit]) => ({ domain, hit })) };
}

// ── Company profiles (harvestapi/linkedin-company) ──────────────────────────────────────────────
export type CompanyProfile = { linkedinUrl: string; name: string; website: string | null; domain: string | null; description: string | null; industry: string | null; employeeCount: number | null; employeeBand: string | null; city: string | null; state: string | null; country: string | null };
/** Fields as in the Actor's documented example: linkedinUrl, name, website, description, industries[], employeeCount, employeeCountRange.start, locations[{headquarter, parsed}]. */
export function mapCompanyProfile(item: unknown): CompanyProfile | null {
  const r = (item ?? {}) as Record<string, unknown>;
  const linkedinUrl = linkedInCompanyUrl(typeof r.linkedinUrl === "string" ? r.linkedinUrl : null);
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!linkedinUrl || !name) return null;
  const website = typeof r.website === "string" && r.website.trim() ? r.website.trim() : null;
  const locations = Array.isArray(r.locations) ? (r.locations as Record<string, unknown>[]) : [];
  const hq = locations.find(l => l?.headquarter === true) ?? locations[0];
  const parsed = (hq?.parsed ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const range = (r.employeeCountRange ?? {}) as { start?: unknown; end?: unknown };
  const start = typeof range.start === "number" ? range.start : null; const end = typeof range.end === "number" ? range.end : null;
  return {
    linkedinUrl, name, website, domain: companyDomain(website),
    description: str(r.description) ?? str(r.tagline), industry: Array.isArray(r.industries) ? str(r.industries[0]) : null,
    employeeCount: typeof r.employeeCount === "number" ? r.employeeCount : null, employeeBand: start !== null ? (end !== null ? `${start}–${end}` : `${start}+`) : null,
    city: str(parsed.city) ?? str(hq?.city), state: str(parsed.state), country: str(parsed.country) ?? str(hq?.country),
  };
}

// ── Scoring ──────────────────────────────────────────────────────────────────────────────────────
export type ScoreContext = { name: string; evidenceDomains: string[]; evidenceLinkedin: string[]; searchWebsites: string[]; expectedCountry: string | null; opportunityTerms: string[] };
export type Scored = { profile: CompanyProfile; score: number; reasons: string[]; conflicts: string[] };
const NAME_POINTS = { exact: 40, contains: 25, partial: 15, different: 0 } as const;
export const RESOLVE_AT = 60;
const MARGIN = 20;

/** Points for each piece of agreeing evidence, and deductions for each known conflict. */
export function scoreCandidate(profile: CompanyProfile, ctx: ScoreContext): Scored {
  const reasons: string[] = []; const conflicts: string[] = [];
  const sim = nameSimilarity(profile.name, ctx.name);
  let score = NAME_POINTS[sim];
  if (sim !== "different") reasons.push(`Name ${sim === "exact" ? "matches" : "is similar"} (“${profile.name}”).`); else conflicts.push(`Name differs (“${profile.name}”).`);
  if (ctx.evidenceLinkedin.includes(profile.linkedinUrl)) { score += 40; reasons.push("This LinkedIn page is linked in the opportunity's own source."); }
  if (profile.domain && ctx.evidenceDomains.includes(profile.domain)) { score += 30; reasons.push(`Its website ${profile.domain} appears in the opportunity's source.`); }
  else if (profile.domain && ctx.searchWebsites.includes(profile.domain)) { score += 10; reasons.push(`Its website ${profile.domain} also came up when searching the name.`); }
  if (ctx.expectedCountry && profile.country) {
    if (profile.country.toLowerCase().includes(ctx.expectedCountry.toLowerCase()) || ctx.expectedCountry.toLowerCase().includes(profile.country.toLowerCase())) { score += 10; reasons.push(`Headquartered in ${profile.country}, as expected.`); }
    else { score -= 15; conflicts.push(`Headquartered in ${profile.country}, not ${ctx.expectedCountry}.`); }
  }
  const about = `${profile.industry ?? ""} ${profile.description ?? ""}`.toLowerCase();
  const overlap = ctx.opportunityTerms.filter(t => t.length > 2 && about.includes(t.toLowerCase()));
  if (overlap.length) { score += 10; reasons.push(`Its description mentions ${overlap.slice(0, 3).join(", ")}.`); }
  return { profile, score: Math.max(0, Math.min(100, score)), reasons, conflicts };
}

export type Decision =
  | { kind: "resolved"; best: Scored; others: Scored[] }
  | { kind: "ambiguous"; candidates: Scored[]; why: string }
  | { kind: "none"; why: string };
/**
 * Resolved only with corroboration (a name match alone is 40, below the bar of 60) and a clear
 * margin over the runner-up. Otherwise a person chooses between the plausible ones.
 */
export function decide(scored: Scored[]): Decision {
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const plausible = ranked.filter(s => s.score >= 25);
  if (!plausible.length) return { kind: "none", why: ranked.length ? "No company found matched the name closely enough." : "No company page was found for this name." };
  const [best, second] = plausible;
  if (best.score >= RESOLVE_AT && (!second || best.score - second.score >= MARGIN)) return { kind: "resolved", best, others: plausible.slice(1) };
  const why = best.score < RESOLVE_AT
    ? "The name matches, but nothing else in the evidence confirms which company this is."
    : `More than one company fits: ${best.profile.name} and ${second.profile.name} are within ${MARGIN} points of each other.`;
  return { kind: "ambiguous", candidates: plausible.slice(0, 5), why };
}
