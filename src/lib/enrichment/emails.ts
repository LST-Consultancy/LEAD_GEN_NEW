import { personKey } from "@/lib/opportunities/authority";
import { companyDomain, nameKey } from "./identity";

/**
 * Business email addresses that were actually found — in the opportunity's own sources, on the
 * company's website, or returned by the employee search — each with where it was found. Pure.
 * Nothing here guesses an address from a name pattern, and a role address (info@, sales@) is a
 * company contact, never given to a person.
 */

const EMAIL_RE = /\b[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;
const ROLE_LOCAL = /^(?:info|sales|contact|contactus|hello|hi|hr|careers?|jobs|recruit(?:ment|ing)?|talent|support|help|admin|office|enquir(?:y|ies)|inquir(?:y|ies)|team|business|biz|marketing|accounts?|billing|finance|legal|privacy|media|press|pr|partners?|partnerships|vendors?|procurement|purchase|noreply|no-reply|donotreply|webmaster|postmaster|abuse|service|services|mail|email|ops|operations|general)$/i;
const FREE = /@(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|proton|protonmail|zoho|rediffmail|gmx|mail|yandex)\./i;
// Addresses in page templates and examples, not anyone's inbox.
const PLACEHOLDER = /@(?:example|domain|email|yourcompany|company|sentry|wixpress)\.|^(?:name|user|your|test|email|someone|john\.doe|jane\.doe)@|\.(?:png|jpe?g|gif|webp|svg)$/i;

export const isRoleAddress = (email: string) => ROLE_LOCAL.test(email.split("@")[0] ?? "");
export const isFreeMailbox = (email: string) => FREE.test(email);

/**
 * How an address's domain relates to the company:
 * - matched: the company's website domain (or a subdomain of it);
 * - alias:   another domain already corroborated as the company's email domain;
 * - review:  not known to be the company's — kept, with its evidence, for a person to decide;
 * - rejected: a person said the domain is not the company's; kept as evidence only;
 * - free:    a free mailbox (gmail, outlook…), which says nothing about the company.
 * Nothing is discarded for its domain; only matched and alias addresses can be given to a person.
 */
export type DomainStatus = "matched" | "alias" | "review" | "rejected" | "free";
export type EvidenceKind = "source" | "website" | "employee_search" | "company_profile" | "provider";
export type FoundEmail = { email: string; generic: boolean; sameDomain: boolean; domainStatus: DomainStatus; free: boolean; evidence: { kind: EvidenceKind; url: string | null; excerpt: string | null; provider?: string } };

// Two-part endings (co.in, co.uk…); any other domain loses just its last part. What is left's last
// label is the name compared: atzean.com, atzean.in and atzean.co.in all give "atzean".
const TWO_PART = /\.(?:co|com|net|org|gov|ac|edu|ltd|plc|gen|firm|ind)\.[a-z]{2}$/i;
export const domainLabel = (host: string) => {
  const h = host.toLowerCase().replace(/^www\./, "");
  const base = TWO_PART.test(h) ? h.replace(TWO_PART, "") : h.includes(".") ? h.slice(0, h.lastIndexOf(".")) : h;
  return base.split(".").at(-1) ?? "";
};

/**
 * Whether a domain seen in evidence can be accepted as the company's email domain without asking.
 * Accepted: the same name as the website domain on another ending (atzean.in for atzean.com), or —
 * when the company's own page or website published it — a domain whose name is the company's name.
 * Anything else is left for review; an address merely appearing near a company name proves nothing.
 */
export function corroborateAlias(host: string, websiteDomain: string | null, companyName: string, kind: EvidenceKind): { accepted: boolean; basis: string } {
  const label = domainLabel(host);
  if (label.length < 3 || FREE.test(`@${host}`)) return { accepted: false, basis: "Too short or a free mailbox to tie to the company." };
  const site = websiteDomain ? domainLabel(websiteDomain) : "";
  if (site && site === label) return { accepted: true, basis: `Same name as the website domain ${websiteDomain} on a different ending.` };
  const companyLabel = nameKey(companyName).replace(/\s+/g, "");
  const ownPublication = kind === "company_profile" || kind === "website";
  if (ownPublication && companyLabel.length >= 4 && (label === companyLabel || companyLabel.startsWith(label) && label.length >= 5)) {
    return { accepted: true, basis: `The company's own ${kind === "website" ? "website" : "profile"} publishes it, and the domain is the company's name.` };
  }
  return { accepted: false, basis: websiteDomain ? `Not the website domain (${websiteDomain}) and not corroborated as the company's.` : "The company's website is not known, so the domain cannot be checked yet." };
}

export function extractEmails(text: string, companyDomainValue: string | null, evidence: Omit<FoundEmail["evidence"], "excerpt">, aliases: string[] = []): FoundEmail[] {
  const out = new Map<string, FoundEmail>();
  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase().replace(/\.$/, "");
    if (PLACEHOLDER.test(email) || out.has(email)) continue;
    const at = m.index ?? 0;
    out.set(email, classify(email, companyDomainValue, { ...evidence, excerpt: text.slice(Math.max(0, at - 80), at + email.length + 40).replace(/\s+/g, " ").trim() }, aliases));
  }
  return [...out.values()];
}
/** Classifies any address, from any provider: role or personal, and how its domain relates. */
export function classify(email: string, domain: string | null, evidence: FoundEmail["evidence"], aliases: string[] = []): FoundEmail {
  const address = email.trim().toLowerCase();
  const host = address.split("@")[1] ?? "";
  const d = companyDomain(domain);
  const under = (x: string) => host === x || host.endsWith(`.${x}`);
  const free = isFreeMailbox(address);
  const domainStatus: DomainStatus = free ? "free" : d && under(d) ? "matched" : aliases.some(a => under(a.toLowerCase())) ? "alias" : "review";
  return { email: address, generic: isRoleAddress(address), sameDomain: domainStatus === "matched" || domainStatus === "alias", domainStatus, free, evidence };
}

/** automation-lab/website-contact-finder items: `{ websiteUrl, emails[], contactPageUrl, scanStatus, failureReason }`. */
export function mapWebsiteItems(items: unknown[], domain: string | null, aliases: string[] = []) {
  const found: FoundEmail[] = []; const problems: string[] = []; let pagesSucceeded = 0; const socials: string[] = []; const phones: { phone: string; url: string | null }[] = [];
  for (const item of items) {
    const r = (item ?? {}) as Record<string, unknown>;
    const page = typeof r.contactPageUrl === "string" ? r.contactPageUrl : typeof r.websiteUrl === "string" ? r.websiteUrl : null;
    for (const e of Array.isArray(r.emails) ? r.emails : []) {
      if (typeof e !== "string") continue;
      const email = e.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) || PLACEHOLDER.test(email)) continue;
      found.push(classify(email, domain, { kind: "website", url: page, excerpt: null }, aliases));
    }
    for (const ph of Array.isArray(r.phones) ? r.phones : []) {
      const phone = typeof ph === "string" ? normalisePhone(ph) : null;
      if (phone) phones.push({ phone, url: page });
    }
    if (typeof r.pagesSucceeded === "number") pagesSucceeded += r.pagesSucceeded;
    if (r.scanStatus === "failed" || r.scanStatus === "partial") {
      const reason = (r.failureReason ?? {}) as { message?: unknown };
      problems.push(`${r.scanStatus === "failed" ? "The website could not be read" : "Part of the website could not be read"}${typeof reason.message === "string" ? `: ${reason.message}` : "."}`);
    }
    const li = ((r.socialLinks ?? {}) as { linkedin?: unknown }).linkedin;
    if (typeof li === "string") socials.push(li);
  }
  return { found: dedupe(found), problems, pagesSucceeded, linkedinLinks: socials, phones: [...new Map(phones.map(p => [p.phone, p])).values()] };
}

/** A published business phone as digits with an optional leading +; anything too short is not one. */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}
const dedupe = (list: FoundEmail[]) => [...new Map(list.map(f => [f.email, f])).values()];

/**
 * The saved person an address appears to belong to, and how strongly. Always an inference — an
 * address that contains a name is not proof its owner is that person — so every caller records it
 * as inferred, never as confirmed ownership.
 * - "full_name": the local part contains the person's whole first and last name;
 * - "first_last_initial": first name plus last initial ("janed"), weaker; not enough to attach.
 * Two people who both fit: nobody gets it.
 */
export type Ownership = { personId: string; strength: "full_name" | "first_last_initial" };
export function inferOwner(email: string, people: { id: string; fullName: string; firstName?: string | null; lastName?: string | null }[]): Ownership | null {
  const local = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (local.length < 4) return null;
  const hits: Ownership[] = [];
  for (const p of people) {
    const parts = personKey(p.fullName).split(" ").filter(Boolean);
    const first = (p.firstName ?? parts[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const last = (p.lastName ?? parts.at(-1) ?? "").toLowerCase().replace(/[^a-z]/g, "");
    if (first.length < 2 || last.length < 2 || first === last) continue;
    if (first.length >= 3 && last.length >= 3 && local.includes(first) && local.includes(last)) hits.push({ personId: p.id, strength: "full_name" });
    else if (local === `${first}${last[0]}`) hits.push({ personId: p.id, strength: "first_last_initial" });
  }
  return hits.length === 1 ? hits[0] : null;
}
/** Back-compatible: the person an address names, or null. Prefer `inferOwner`, which says how strongly. */
export function ownerOf(email: string, people: { id: string; fullName: string; firstName?: string | null; lastName?: string | null }[]): string | null {
  return inferOwner(email, people)?.personId ?? null;
}
