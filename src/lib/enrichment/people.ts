import { titleAuthority } from "@/lib/opportunities/authority";
import { linkedInCompanyUrl, nameSimilarity } from "./identity";

/**
 * Who at a company is worth contacting about one opportunity, from employee profiles returned by
 * harvestapi/linkedin-company-employees. Pure. Decision-making authority is always an inference
 * from a title, and is labelled as one wherever it is stored or shown.
 */

export type RoleFocus = "vendor_staffing" | "technology" | "general";
const FOCUS_TERMS: Record<RoleFocus, string[]> = {
  vendor_staffing: ["partnership", "alliances", "vendor", "procurement", "purchasing", "sourcing", "delivery", "talent acquisition", "recruitment", "hr", "human resources", "resource management", "operations", "account manager", "business development"],
  technology: ["cio", "cto", "it ", "information technology", "enterprise applications", "business systems", "erp", "digital", "technology", "engineering", "infrastructure", "solutions architect", "applications"],
  general: ["operations", "business development", "strategy"],
};
const LEADERSHIP = ["founder", "co-founder", "ceo", "chief", "managing director", "director", "head of", "vp", "vice president", "president", "partner", "owner", "general manager"];

/** Staffing and vendor asks go to partnerships, procurement, delivery and talent; implementations to IT owners. */
export function roleFocus(types: string[]): RoleFocus {
  if (types.some(t => ["STAFF_AUGMENTATION", "OUTSOURCING", "EXTERNAL_VENDOR", "INTERNAL_HIRING"].includes(t)) && !types.some(t => ["IMPLEMENTATION", "INTEGRATION", "MIGRATION"].includes(t))) return "vendor_staffing";
  if (types.some(t => ["IMPLEMENTATION", "INTEGRATION", "MIGRATION", "DIGITAL_TRANSFORMATION", "CONSULTING"].includes(t))) return "technology";
  return "general";
}
const FOCUS_TITLES: Record<RoleFocus, string[]> = {
  vendor_staffing: ["Talent Acquisition", "Delivery", "Partnerships", "Vendor", "Procurement"],
  technology: ["CIO", "CTO", "IT", "Enterprise Applications", "Business Systems", "Head of Technology"],
  general: ["Head of", "Operations"],
};
/**
 * The fuzzy search query sent to the Actor (it supports LinkedIn's OR operator). A small company
 * adds its founders and leaders to the roles the ask needs, since one person often holds several.
 */
export function searchQueryFor(focus: RoleFocus, smallCompany: boolean): string {
  const titles = smallCompany ? ["Founder", "Co-Founder", "CEO", "Managing Director", ...FOCUS_TITLES[focus].slice(0, 3)]
    : [...FOCUS_TITLES[focus], "Founder", "CEO", "Director"];
  return titles.map(t => (t.includes(" ") ? `"${t}"` : t)).join(" OR ");
}
export function relevance(title: string, focus: RoleFocus): { score: number; why: string[] } {
  const t = ` ${title.toLowerCase()} `;
  const why: string[] = []; let score = 0;
  const hits = FOCUS_TERMS[focus].filter(k => t.includes(k));
  if (hits.length) { score += 50; why.push(`Title mentions ${hits.slice(0, 2).join(", ")}.`); }
  const lead = LEADERSHIP.find(k => t.includes(k));
  if (lead) { score += 30; why.push(`Leadership title (${lead}).`); }
  return { score, why };
}

export type Association = "current" | "former" | "uncertain";
export type PersonCandidate = {
  profileKey: string | null; linkedinUrl: string | null; fullName: string; firstName: string | null; lastName: string | null;
  headline: string | null; title: string; city: string | null; state: string | null; country: string | null;
  association: Association; associationBasis: string; employer: string | null;
  relevance: number; relevanceWhy: string[]; authority: { inferred: true; seniority: string | null; likelyDecisionMaker: boolean; basis: string };
  emails: string[]; emailField: string | null;
};

type Experience = { position?: unknown; companyName?: unknown; companyLinkedinUrl?: unknown; endDate?: { text?: unknown } | null; startDate?: unknown };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** LinkedIn's public id from a profile URL, lower-cased: stable across name changes and spellings. */
export function profileKeyOf(url: string | null, publicIdentifier?: unknown): string | null {
  const id = str(publicIdentifier);
  if (id && !/^ACo/i.test(id)) return `li:${id.toLowerCase()}`;
  if (!url) return id ? `li:${id}` : null;
  try { const m = /^\/in\/([^/?#]+)/.exec(new URL(url).pathname); return m ? `li:${decodeURIComponent(m[1]).toLowerCase()}` : null; } catch { return null; }
}

/**
 * One profile as a person at `company`. Current means a matching position with no end date or an
 * end of "Present"; former means every matching position has ended; uncertain means the search
 * returned them but no position names this company. Missing names, titles or emails are kept
 * missing — nothing is filled in.
 */
export function mapEmployee(item: unknown, company: { name: string; linkedinUrl: string | null }, focus: RoleFocus, emailSearchMode: boolean): PersonCandidate | null {
  const r = (item ?? {}) as Record<string, unknown>;
  const linkedinUrl = str(r.linkedinUrl);
  const firstName = str(r.firstName); const lastName = str(r.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || str(r.fullName) || str(r.name);
  if (!fullName && !linkedinUrl) return null;
  const experience = (Array.isArray(r.experience) ? r.experience : []) as Experience[];
  const current = (Array.isArray(r.currentPosition) ? r.currentPosition : []) as Experience[];
  const mine = (e: Experience) => {
    const li = linkedInCompanyUrl(str(e.companyLinkedinUrl));
    if (li && company.linkedinUrl) return li === company.linkedinUrl;
    const n = str(e.companyName);
    return n ? ["exact", "contains"].includes(nameSimilarity(n, company.name)) : false;
  };
  const ended = (e: Experience) => { const t = str(e.endDate?.text); return t !== null && !/present/i.test(t); };
  const atCompany = experience.filter(mine);
  const liveHere = atCompany.filter(e => !ended(e));
  let association: Association; let basis: string; let title = "";
  if (liveHere.length) { association = "current"; basis = "A position at this company with no end date."; title = str(liveHere[0].position) ?? ""; }
  else if (current.some(mine)) { association = "current"; basis = "Listed under current positions at this company."; title = str(current.find(mine)?.position) ?? ""; }
  else if (atCompany.length) { association = "former"; basis = "Every position at this company has ended."; title = str(atCompany[0].position) ?? ""; }
  else { association = "uncertain"; basis = "Returned by the employee search, but no listed position names this company."; }
  const headline = str(r.headline);
  const loc = ((r.location ?? {}) as { parsed?: Record<string, unknown>; linkedinText?: unknown });
  const rel = relevance(title || headline || "", focus);
  const role = titleAuthority(title || headline || "");
  // The email field of "Full + email search" mode is not in the Actor's documented example, so it
  // is read only in that mode, only as plain addresses, and the field it came from is recorded.
  const emails: string[] = []; let emailField: string | null = null;
  if (emailSearchMode) for (const [field, v] of [["email", r.email], ["emails", r.emails]] as const) {
    for (const e of Array.isArray(v) ? v : [v]) {
      const addr = typeof e === "string" ? e : str((e as { email?: unknown } | null)?.email);
      if (addr && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(addr)) { emails.push(addr.toLowerCase()); emailField = field; }
    }
  }
  return {
    profileKey: profileKeyOf(linkedinUrl, r.publicIdentifier), linkedinUrl, fullName: fullName ?? "Name not shown", firstName, lastName, headline, title,
    city: str(loc.parsed?.city), state: str(loc.parsed?.state), country: str(loc.parsed?.country),
    association, associationBasis: basis, employer: association === "uncertain" ? null : company.name,
    relevance: association === "former" ? 0 : rel.score, relevanceWhy: rel.why,
    authority: { inferred: true, seniority: role.seniority, likelyDecisionMaker: role.likelyDecisionMaker, basis: title ? `Inferred from the title “${title}”; not confirmed.` : "No title to infer from." },
    emails: [...new Set(emails)], emailField,
  };
}

/** Relevant current people first, then uncertain ones; former employees are kept but never ranked for contact. */
export function rankPeople(people: PersonCandidate[], limit: number): PersonCandidate[] {
  const order: Record<Association, number> = { current: 0, uncertain: 1, former: 2 };
  return [...people].sort((a, b) => order[a.association] - order[b.association] || b.relevance - a.relevance).slice(0, limit);
}

// Headlines of people who post on someone else's behalf.
const INTERMEDIARY = /\b(?:recruit\w*|talent (?:partner|sourcer)|staffing|headhunt\w*|placement|hr consultant|freelanc\w*|agency|consultant at)\b/i;
/**
 * The person who wrote the opportunity's post, if they can be tied to the buyer: their headline
 * must name the company, and not describe a recruiter or agency posting for a client.
 */
export function assessAuthor(ref: unknown, companyName: string): { ok: true; name: string; profileUrl: string | null; headline: string; basis: string } | { ok: false; why: string } | null {
  const r = (ref ?? {}) as { authorName?: unknown; authorHeadline?: unknown; authorProfileUrl?: unknown };
  const name = str(r.authorName); const headline = str(r.authorHeadline) ?? "";
  if (!name) return null;
  if (INTERMEDIARY.test(headline)) return { ok: false, why: `The post's author (${name}) describes themselves as a recruiter or intermediary, so they may not work for the buyer.` };
  const at = /(?:\bat\b|@)\s+(.+)$/i.exec(headline)?.[1] ?? "";
  if (!at || nameSimilarity(at.split(/[|,·•]/)[0], companyName) === "different") return { ok: false, why: `The post's author (${name}) does not name this company in their headline, so it is not assumed they work there.` };
  const url = str(r.authorProfileUrl);
  return { ok: true, name, profileUrl: url && /^https:\/\/([a-z]+\.)?linkedin\.com\/in\//.test(url) ? url : null, headline, basis: "Wrote the opportunity's post, and their headline names this company." };
}
