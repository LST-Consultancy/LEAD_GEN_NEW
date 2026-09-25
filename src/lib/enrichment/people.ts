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

// Words in the request itself that mark a vendor, staffing or partnership ask.
const VENDOR_ASK = /\b(?:vendors?|staffing|staff augmentation|augment|bench|c2c|contract(?:ors?|ual)?|outsourc\w*|partners?(?:hip)?s?|agenc(?:y|ies)|resources?|consultants? (?:needed|required|wanted)|rate card|empanel\w*|subcontract\w*|white[- ]label)\b/i;
const TECH_ASK = /\b(?:implement\w*|integrat\w*|migrat\w*|erp|crm|netsuite|salesforce|sap|oracle|dynamics|odoo|zoho|cloud|devops|architect\w*)\b/i;

/**
 * Who to look for, read from the ask as well as its tags, most important first. A staffing or
 * vendor-partnership request is routed to partnerships, vendor management, delivery and
 * procurement even when it is also tagged as an implementation — the tag names the work, the
 * wording names who buys it. Both groups are returned when both apply.
 */
export function roleFocuses(types: string[], text = ""): RoleFocus[] {
  const vendorTag = types.some(t => ["STAFF_AUGMENTATION", "OUTSOURCING", "EXTERNAL_VENDOR"].includes(t));
  const techTag = types.some(t => ["IMPLEMENTATION", "INTEGRATION", "MIGRATION", "DIGITAL_TRANSFORMATION", "CONSULTING"].includes(t));
  const vendorText = VENDOR_ASK.test(text);
  const techText = TECH_ASK.test(text);
  const out: RoleFocus[] = [];
  if (vendorTag || vendorText) out.push("vendor_staffing");
  if (techTag || techText) out.push("technology");
  if (!out.length && types.includes("INTERNAL_HIRING")) out.push("vendor_staffing");
  return out.length ? out : ["general"];
}
/** The primary focus, for callers that need one. */
export function roleFocus(types: string[], text = ""): RoleFocus {
  return roleFocuses(types, text)[0];
}
const FOCUS_TITLES: Record<RoleFocus, string[]> = {
  vendor_staffing: ["Partnerships", "Vendor", "Delivery", "Procurement", "Business Development", "Talent Acquisition"],
  technology: ["CIO", "CTO", "IT", "Enterprise Applications", "Business Systems", "Head of Technology"],
  general: ["Head of", "Operations"],
};
/**
 * The fuzzy search query sent to the Actor (it supports LinkedIn's OR operator). A small company
 * adds its founders and leaders to the roles the ask needs, since one person often holds several.
 */
export function searchQueryFor(focus: RoleFocus | RoleFocus[], smallCompany: boolean): string {
  const focuses = Array.isArray(focus) ? focus : [focus];
  // Every group the ask needs gets its titles in, the primary group first, within one query.
  const per = focuses.length > 1 ? 3 : FOCUS_TITLES[focuses[0]].length;
  const roleTitles = focuses.flatMap(f => FOCUS_TITLES[f].slice(0, per));
  const titles = smallCompany ? ["Founder", "Co-Founder", "CEO", "Managing Director", ...roleTitles]
    : [...roleTitles, "Founder", "CEO", "Director"];
  return [...new Set(titles)].map(t => (t.includes(" ") ? `"${t}"` : t)).join(" OR ");
}
export function relevance(title: string, focus: RoleFocus | RoleFocus[]): { score: number; why: string[] } {
  const t = ` ${title.toLowerCase()} `;
  const why: string[] = []; let score = 0;
  const focuses = Array.isArray(focus) ? focus : [focus];
  const hits = [...new Set(focuses.flatMap(f => FOCUS_TERMS[f]))].filter(k => t.includes(k));
  if (hits.length) { score += 50; why.push(`Title mentions ${hits.slice(0, 2).join(", ")}.`); }
  const lead = LEADERSHIP.find(k => t.includes(k));
  if (lead) { score += 30; why.push(`Leadership title (${lead}).`); }
  return { score, why };
}

export type Association = "current" | "former" | "uncertain";
export type PersonCandidate = {
  profileKey: string | null; linkedinUrl: string | null; fullName: string; firstName: string | null; lastName: string | null;
  headline: string | null; title: string; city: string | null; state: string | null; country: string | null;
  association: Association; associationBasis: string; employer: string | null; startedAt?: string | null;
  relevance: number; relevanceWhy: string[]; authority: { inferred: true; seniority: string | null; likelyDecisionMaker: boolean; basis: string };
  emails: string[]; emailField: string | null;
};

type Experience = { position?: unknown; title?: unknown; companyName?: unknown; companyLinkedinUrl?: unknown; current?: unknown; endDate?: { text?: unknown } | null; startDate?: unknown; startedOn?: { month?: unknown; year?: unknown } | null };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** LinkedIn's public id from a profile URL, lower-cased: stable across name changes and spellings. */
export function profileKeyOf(url: string | null, publicIdentifier?: unknown): string | null {
  const id = str(publicIdentifier);
  if (id && !/^ACo/i.test(id)) return `li:${id.toLowerCase()}`;
  if (!url) return id ? `li:${id}` : null;
  try { const m = /^\/in\/([^/?#]+)/.exec(new URL(url).pathname); return m ? `li:${decodeURIComponent(m[1]).toLowerCase()}` : null; } catch { return null; }
}

/**
 * One profile as a person at `company`. Two shapes are read, because the Actor returns different
 * ones by mode: the recorded "Short" output lists `currentPositions[]` with `title`, `companyName`,
 * `companyLinkedinUrl`, `current` and `startedOn`; the documented "Full" output lists
 * `experience[]` with `position` and `endDate`. Current means a matching position that has not
 * ended; former means every matching position has ended; uncertain means nothing names this
 * company. Missing names, titles or emails are kept missing — nothing is filled in.
 */
export function mapEmployee(item: unknown, company: { name: string; linkedinUrl: string | null }, focus: RoleFocus | RoleFocus[], emailSearchMode: boolean): PersonCandidate | null {
  const r = (item ?? {}) as Record<string, unknown>;
  const linkedinUrl = str(r.linkedinUrl);
  const firstName = str(r.firstName); const lastName = str(r.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || str(r.fullName) || str(r.name);
  if (!fullName && !linkedinUrl) return null;
  const experience = (Array.isArray(r.experience) ? r.experience : []) as Experience[];
  const current = [
    ...((Array.isArray(r.currentPositions) ? r.currentPositions : []) as Experience[]),
    ...((Array.isArray(r.currentPosition) ? r.currentPosition : []) as Experience[]),
  ];
  const mine = (e: Experience) => {
    const li = linkedInCompanyUrl(str(e.companyLinkedinUrl));
    if (li && company.linkedinUrl) return li === linkedInCompanyUrl(company.linkedinUrl);
    const n = str(e.companyName);
    return n ? ["exact", "contains"].includes(nameSimilarity(n, company.name)) : false;
  };
  const titleOf = (e: Experience | undefined) => (e ? str(e.title) ?? str(e.position) ?? "" : "");
  const ended = (e: Experience) => { if (e.current === false) return true; const t = str(e.endDate?.text); return t !== null && !/present/i.test(t); };
  const since = (e: Experience | undefined) => {
    const y = Number(e?.startedOn?.year); const m = Number(e?.startedOn?.month);
    return Number.isFinite(y) && y > 1900 ? `${y}${Number.isFinite(m) && m >= 1 && m <= 12 ? `-${String(m).padStart(2, "0")}` : ""}` : str(e?.startDate as unknown);
  };
  const atCompany = experience.filter(mine);
  const liveHere = atCompany.filter(e => !ended(e));
  const currentHere = current.filter(mine).filter(e => e.current !== false);
  let association: Association; let basis: string; let title = ""; let startedAt: string | null = null;
  if (currentHere.length) { association = "current"; basis = "Listed under current positions at this company."; title = titleOf(currentHere[0]); startedAt = since(currentHere[0]); }
  else if (liveHere.length) { association = "current"; basis = "A position at this company with no end date."; title = titleOf(liveHere[0]); startedAt = since(liveHere[0]); }
  else if (atCompany.length || current.some(mine)) { association = "former"; basis = "Every position at this company has ended."; title = titleOf(atCompany[0] ?? current.find(mine)); }
  else if (current.length) { association = "uncertain"; basis = `Returned by the employee search, but their current position is at ${str(current[0].companyName) ?? "another company"}, not this one.`; }
  else { association = "uncertain"; basis = "Returned by the employee search, but no listed position names this company."; }
  const headline = str(r.headline);
  const loc = ((r.location ?? {}) as { parsed?: Record<string, unknown>; linkedinText?: unknown });
  const parsed = loc.parsed ?? {};
  const text = str(loc.linkedinText);
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
    city: str(parsed.city) ?? (text ? text.split(",")[0].trim() || null : null), state: str(parsed.state), country: str(parsed.country),
    association, associationBasis: basis, employer: association === "uncertain" ? null : company.name, startedAt,
    relevance: association === "former" ? 0 : rel.score, relevanceWhy: rel.why,
    authority: { inferred: true, seniority: role.seniority, likelyDecisionMaker: association === "current" && role.likelyDecisionMaker, basis: title ? `Inferred from the title “${title}”; not confirmed.` : "No title to infer from." },
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
export type AuthorAssessment =
  | { ok: true; name: string; profileUrl: string | null; headline: string; basis: string; recruiter: boolean }
  | { ok: false; why: string; intermediary: boolean; name: string; profileUrl: string | null; headline: string };
/**
 * The person who wrote the opportunity's post, tied to the buyer only by evidence: their headline
 * must name the company. A recruiter whose headline names the buyer is an in-house recruiter and a
 * real contact — recruiting wording alone does not disqualify them. One who does not name the buyer
 * may be posting for a client; they are kept as the source contact, not as an employee.
 */
export function assessAuthor(ref: unknown, companyName: string): AuthorAssessment | null {
  const r = (ref ?? {}) as { authorName?: unknown; authorHeadline?: unknown; authorProfileUrl?: unknown };
  const name = str(r.authorName); const headline = str(r.authorHeadline) ?? "";
  if (!name) return null;
  const rawUrl = str(r.authorProfileUrl);
  const profileUrl = rawUrl && /^https:\/\/([a-z]+\.)?linkedin\.com\/in\//.test(rawUrl) ? rawUrl : null;
  const recruiter = INTERMEDIARY.test(headline);
  const at = /(?:\bat\b|@)\s+(.+)$/i.exec(headline)?.[1] ?? "";
  const namesCompany = Boolean(at) && nameSimilarity(at.split(/[|,·•]/)[0], companyName) !== "different";
  if (namesCompany) return { ok: true, name, profileUrl, headline, recruiter, basis: recruiter ? "Wrote the opportunity's post; their headline names this company, so they recruit for it in-house." : "Wrote the opportunity's post, and their headline names this company." };
  if (recruiter) return { ok: false, intermediary: true, name, profileUrl, headline, why: `The post's author (${name}) describes themselves as a recruiter or intermediary and does not name this company, so they may be posting for a client. Kept as the source contact, not saved as an employee.` };
  return { ok: false, intermediary: false, name, profileUrl, headline, why: `The post's author (${name}) does not name this company in their headline, so it is not assumed they work there. Kept as the source contact.` };
}
