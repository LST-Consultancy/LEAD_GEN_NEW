import type { CheckResult } from "./verification";
import type { Returned } from "./identity-gate";
import { companyDomain, linkedInCompanyUrl, nameSimilarity } from "./identity";
import { profileKeyOf } from "./people";

/**
 * Provider responses mapped to what the runner needs, from each provider's documented fields
 * (docs/provider-contracts.md). Pure, so each mapping is tested against the documented shapes.
 */
const s = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "n/a" ? v.trim() : null);

/** A person the provider returned, with the evidence the identity gate compares. */
export type ProviderPerson = {
  fullName: string; firstName: string | null; lastName: string | null; title: string | null;
  linkedinUrl: string | null; profileKey: string | null; city: string | null;
  employer: Returned["employer"]; emails: { email: string; label: string | null; score: number | null; providerStatus: string | null }[];
  ref: string; providerConfidence: Returned["providerConfidence"];
};
const split = (full: string) => { const p = full.trim().split(/\s+/); return { first: p[0] ?? null, last: p.length > 1 ? p.slice(1).join(" ") : null }; };

// ── SignalHire ──────────────────────────────────────────────────────────────────────────────────

/** A Person API candidate. Only work (or unlabelled) emails; personal ones are never used. */
export function signalHireCandidate(c: { uid: string; fullName: string; headLine?: string | null; locations?: { name?: string | null }[] | null; social?: { type: string; link?: string | null }[] | null; contacts?: { type: string; value: string; subType?: string | null; rating?: number }[] | null; experience?: { company?: string | null; position?: string | null; current?: boolean; website?: string | null; companyUrl?: string | null }[] | null }): ProviderPerson {
  const current = c.experience?.find(e => e.current === true) ?? null;
  const li = c.social?.find(x => x.type === "li")?.link ?? null;
  const n = split(c.fullName);
  return {
    fullName: c.fullName, firstName: n.first, lastName: n.last, title: s(current?.position),
    linkedinUrl: s(li), profileKey: profileKeyOf(s(li)) ?? `sh:${c.uid}`, city: s(c.locations?.[0]?.name)?.split(",")[0]?.trim() ?? null,
    employer: current ? { name: s(current.company), domain: companyDomain(s(current.website)), linkedinUrl: linkedInCompanyUrl(s(current.companyUrl)), current: true } : null,
    emails: (c.contacts ?? []).filter(x => x.type === "email" && x.subType !== "personal" && s(x.value)).map(x => ({ email: x.value.trim().toLowerCase(), label: x.subType ?? null, score: x.rating ?? null, providerStatus: null })),
    ref: `signalhire:${c.uid}`, providerConfidence: null,
  };
}

/**
 * A Search API profile. It has no LinkedIn URL and no "current" flag; the first role listed is the
 * latest, so a person counts as at the company only when that first role names it.
 */
export function signalHireSearchPerson(p: { uid: string; fullName?: string | null; location?: string | null; experience?: { company?: string | null; title?: string | null }[] | null }, companyName: string): (ProviderPerson & { atCompany: boolean }) | null {
  if (!s(p.fullName)) return null;
  const latest = p.experience?.[0] ?? null;
  const atCompany = Boolean(latest?.company && nameSimilarity(companyName, latest.company) !== "different");
  const n = split(p.fullName!);
  return { fullName: p.fullName!.trim(), firstName: n.first, lastName: n.last, title: s(latest?.title), linkedinUrl: null, profileKey: `sh:${p.uid}`, city: s(p.location)?.split(",")[0]?.trim() ?? null,
    employer: latest ? { name: s(latest.company), current: atCompany ? true : null } : null, emails: [], ref: `signalhire:${p.uid}`, providerConfidence: null, atCompany };
}

// ── Hunter ──────────────────────────────────────────────────────────────────────────────────────

/** A Domain Search entry: a person known through an address Hunter found at the domain. */
export function hunterDomainPerson(e: { value: string; first_name?: string | null; last_name?: string | null; position?: string | null; linkedin?: string | null; confidence?: number | null; verification?: { status?: string | null } | null }, domain: string): ProviderPerson | null {
  const first = s(e.first_name), last = s(e.last_name);
  if (!first || !last) return null;
  const li = s(e.linkedin) ? (s(e.linkedin)!.includes("linkedin.com") ? s(e.linkedin)! : `https://www.linkedin.com/in/${s(e.linkedin)}`) : null;
  return { fullName: `${first} ${last}`, firstName: first, lastName: last, title: s(e.position), linkedinUrl: li, profileKey: profileKeyOf(li), city: null,
    employer: { domain, current: null }, emails: [{ email: e.value.trim().toLowerCase(), label: "domain_search", score: e.confidence ?? null, providerStatus: s(e.verification?.status) }],
    ref: `hunter:domain-search`, providerConfidence: null };
}

/**
 * Hunter's verifier status in this app's seven outcomes. Only `valid` is a confirmed mailbox;
 * `accept_all` is a catch-all; `webmail` and `disposable` say what kind of address it is, not
 * whether the mailbox exists, so they stay unknown.
 */
export function hunterCheck(d: { status: string; result?: string | null; smtp_check?: boolean | null }): { result: CheckResult; reason: string } {
  switch (d.status) {
    case "valid": return { result: "MAILBOX_CONFIRMED", reason: "Hunter's check found the mailbox accepts mail." };
    case "invalid": return { result: "INVALID", reason: "Hunter's check found the address cannot receive mail." };
    case "accept_all": return { result: "CATCH_ALL", reason: "Hunter found the domain accepts any address, so this mailbox cannot be confirmed." };
    case "webmail": return { result: "UNKNOWN", reason: "Hunter reports a free webmail address; the mailbox was not confirmed." };
    case "disposable": return { result: "UNKNOWN", reason: "Hunter reports a disposable address; the mailbox was not confirmed." };
    default: return { result: d.smtp_check === false ? "INCONCLUSIVE" : "UNKNOWN", reason: "Hunter could not establish whether the mailbox exists." };
  }
}

/** Hunter Company Enrichment in the fields the company record keeps. */
export function hunterCompanyFields(d: { name?: string | null; description?: string | null; category?: { industry?: string | null } | null; geo?: { city?: string | null; state?: string | null; country?: string | null } | null; linkedin?: { handle?: string | null } | null; metrics?: { employees?: string | null; employeesCount?: number | null } | null }) {
  const handle = s(d.linkedin?.handle);
  return { name: s(d.name), description: s(d.description), industry: s(d.category?.industry), city: s(d.geo?.city), state: s(d.geo?.state), country: s(d.geo?.country),
    linkedinUrl: handle ? linkedInCompanyUrl(`https://www.linkedin.com/${handle.replace(/^\/+/, "")}`) : null, employeeCount: d.metrics?.employeesCount ?? null, employeeBand: s(d.metrics?.employees) };
}

// ── Apollo ──────────────────────────────────────────────────────────────────────────────────────

export function apolloPerson(p: { id?: string; first_name?: string | null; last_name?: string | null; name?: string | null; title?: string | null; linkedin_url?: string | null; email?: string | null; email_status?: string | null; organization?: { name?: string | null; primary_domain?: string | null; linkedin_url?: string | null } | null; employment_history?: { organization_name?: string | null; current?: boolean | null }[] | null }, confidence: string | null): ProviderPerson | null {
  const first = s(p.first_name), last = s(p.last_name);
  const full = s(p.name) ?? [first, last].filter(Boolean).join(" ");
  if (!full) return null;
  const email = s(p.email) && !/^email_not_unlocked@/i.test(p.email!) && p.email_status !== "unavailable" ? p.email!.trim().toLowerCase() : null;
  return { fullName: full, firstName: first, lastName: last, title: s(p.title), linkedinUrl: s(p.linkedin_url), profileKey: profileKeyOf(s(p.linkedin_url)), city: null,
    employer: p.organization ? { name: s(p.organization.name), domain: companyDomain(s(p.organization.primary_domain)), linkedinUrl: linkedInCompanyUrl(s(p.organization.linkedin_url)), current: true } : null,
    emails: email ? [{ email, label: s(p.email_status), score: null, providerStatus: s(p.email_status) }] : [],
    ref: p.id ? `apollo:${p.id}` : "apollo:match", providerConfidence: confidence === "high" || confidence === "medium" || confidence === "low" || confidence === "none" ? confidence : null };
}

/** Apollo Organization Enrichment / Search in the fields the company record keeps. */
export function apolloCompanyFields(o: { name?: string | null; website_url?: string | null; primary_domain?: string | null; linkedin_url?: string | null; industry?: string | null; estimated_num_employees?: number | null; city?: string | null; state?: string | null; country?: string | null; short_description?: string | null }) {
  return { name: s(o.name), domain: companyDomain(s(o.primary_domain) ?? s(o.website_url)), website: s(o.website_url), linkedinUrl: linkedInCompanyUrl(s(o.linkedin_url)), industry: s(o.industry),
    employeeCount: o.estimated_num_employees ?? null, city: s(o.city), state: s(o.state), country: s(o.country), description: s(o.short_description) };
}
