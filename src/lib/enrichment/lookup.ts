import { companyDomain, linkedInCompanyUrl } from "./identity";
import { profileKeyOf } from "./people";

/**
 * Lead Lens external lookup: what was asked, and how each provider's answer maps to a person or a
 * company. Pure. Only lookups with a definite target are supported — a LinkedIn profile, a LinkedIn
 * company page or a domain. A bare name would need a paid people search that returns many
 * namesakes, so it stays a workspace-only search.
 */
export type LookupTarget =
  | { kind: "person_linkedin"; key: string; url: string }
  | { kind: "company_linkedin"; key: string; url: string }
  | { kind: "domain"; key: string; domain: string }
  | { kind: "unsupported"; reason: string };

export function classifyTarget(raw: string): LookupTarget {
  const q = raw.trim();
  if (/linkedin\.com\/in\//i.test(q)) {
    const url = q.startsWith("http") ? q : `https://${q.replace(/^\/+/, "")}`;
    const key = profileKeyOf(url);
    return key ? { kind: "person_linkedin", key, url: `https://www.linkedin.com/in/${key.slice(3)}` } : { kind: "unsupported", reason: "That LinkedIn profile address could not be read." };
  }
  if (/linkedin\.com\/company\//i.test(q)) {
    const url = linkedInCompanyUrl(q.startsWith("http") ? q : `https://${q}`);
    return url ? { kind: "company_linkedin", key: `lic:${url.toLowerCase()}`, url } : { kind: "unsupported", reason: "That LinkedIn company address could not be read." };
  }
  if (/^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/?$/i.test(q) && !q.includes(" ")) {
    const domain = companyDomain(q);
    if (domain) return { kind: "domain", key: `dom:${domain}`, domain };
  }
  return { kind: "unsupported", reason: "Paste a LinkedIn profile or company URL, or a company domain. A name alone matches too many people to look up externally; it is searched in this workspace only." };
}

export type LookedUpPerson = {
  fullName: string; firstName: string | null; lastName: string | null; headline: string | null; title: string | null;
  linkedinUrl: string | null; city: string | null; country: string | null;
  employer: { name: string; domain: string | null } | null;
  emails: { email: string; label: string | null; confidence: number | null }[];
  providerRef: string | null;
  /** How sure the provider is that this is the profile asked for; a low match is shown for confirmation. */
  match: "exact" | "high" | "medium" | "low";
};

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const split = (full: string) => { const parts = full.trim().split(/\s+/); return { first: parts[0] ?? null, last: parts.length > 1 ? parts.slice(1).join(" ") : null }; };

/** SignalHire Person API candidate: `{ uid, fullName, headLine, locations[], experience[], contacts[] }`. */
export function fromSignalHire(c: unknown, askedUrl: string): LookedUpPerson | null {
  const r = (c ?? {}) as Record<string, unknown>;
  const fullName = s(r.fullName); if (!fullName) return null;
  const exp = (Array.isArray(r.experience) ? r.experience : []) as Record<string, unknown>[];
  const current = exp.find(e => e.current === true) ?? null;
  const loc = (Array.isArray(r.locations) ? r.locations[0] : null) as Record<string, unknown> | null;
  const n = split(fullName);
  return {
    fullName, firstName: n.first, lastName: n.last, headline: s(r.headLine), title: s(current?.position), linkedinUrl: askedUrl,
    city: s(loc?.name)?.split(",")[0]?.trim() ?? null, country: null,
    employer: current && s(current.company) ? { name: s(current.company)!, domain: companyDomain(s(current.website)) } : null,
    emails: ((Array.isArray(r.contacts) ? r.contacts : []) as Record<string, unknown>[]).filter(x => x.type === "email" && x.subType !== "personal" && s(x.value)).map(x => ({ email: s(x.value)!.toLowerCase(), label: s(x.subType), confidence: typeof x.rating === "number" ? x.rating : null })),
    providerRef: s(r.uid) ? `signalhire:${s(r.uid)}` : null,
    // SignalHire was asked for exactly this profile URL.
    match: "exact",
  };
}

/** Apollo People Enrichment: `{ person: { first_name, last_name, title, linkedin_url, email, email_status, organization{ name, primary_domain } }, match_confidence }`. */
export function fromApollo(person: unknown, confidence: string | null, askedUrl: string): LookedUpPerson | null {
  const p = (person ?? {}) as Record<string, unknown>;
  const first = s(p.first_name); const last = s(p.last_name);
  const fullName = [first, last].filter(Boolean).join(" ");
  if (!fullName) return null;
  const org = (p.organization ?? {}) as Record<string, unknown>;
  const email = s(p.email);
  return {
    fullName, firstName: first, lastName: last, headline: s(p.headline), title: s(p.title), linkedinUrl: s(p.linkedin_url) ?? askedUrl,
    city: s(p.city), country: s(p.country),
    employer: s(org.name) ? { name: s(org.name)!, domain: companyDomain(s(org.primary_domain)) } : null,
    emails: email && !/^email_not_unlocked@/i.test(email) && p.email_status !== "unavailable" ? [{ email: email.toLowerCase(), label: s(p.email_status), confidence: null }] : [],
    providerRef: s(p.id) ? `apollo:${s(p.id)}` : null,
    match: confidence === "high" ? "high" : confidence === "medium" ? "medium" : "low",
  };
}
