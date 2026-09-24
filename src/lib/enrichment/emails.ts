import { personKey } from "@/lib/opportunities/authority";
import { companyDomain } from "./identity";

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

export type FoundEmail = { email: string; generic: boolean; sameDomain: boolean; free: boolean; evidence: { kind: "source" | "website" | "employee_search"; url: string | null; excerpt: string | null } };

export function extractEmails(text: string, companyDomainValue: string | null, evidence: Omit<FoundEmail["evidence"], "excerpt">): FoundEmail[] {
  const out = new Map<string, FoundEmail>();
  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase().replace(/\.$/, "");
    if (PLACEHOLDER.test(email) || out.has(email)) continue;
    const at = m.index ?? 0;
    out.set(email, classify(email, companyDomainValue, { ...evidence, excerpt: text.slice(Math.max(0, at - 80), at + email.length + 40).replace(/\s+/g, " ").trim() }));
  }
  return [...out.values()];
}
export function classify(email: string, domain: string | null, evidence: FoundEmail["evidence"]): FoundEmail {
  const host = email.split("@")[1] ?? "";
  const d = companyDomain(domain);
  return { email, generic: isRoleAddress(email), sameDomain: Boolean(d && (host === d || host.endsWith(`.${d}`))), free: isFreeMailbox(email), evidence };
}

/** automation-lab/website-contact-finder items: `{ websiteUrl, emails[], contactPageUrl, scanStatus, failureReason }`. */
export function mapWebsiteItems(items: unknown[], domain: string | null) {
  const found: FoundEmail[] = []; const problems: string[] = []; let pagesSucceeded = 0; const socials: string[] = [];
  for (const item of items) {
    const r = (item ?? {}) as Record<string, unknown>;
    const page = typeof r.contactPageUrl === "string" ? r.contactPageUrl : typeof r.websiteUrl === "string" ? r.websiteUrl : null;
    for (const e of Array.isArray(r.emails) ? r.emails : []) {
      if (typeof e !== "string") continue;
      const email = e.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) || PLACEHOLDER.test(email)) continue;
      found.push(classify(email, domain, { kind: "website", url: page, excerpt: null }));
    }
    if (typeof r.pagesSucceeded === "number") pagesSucceeded += r.pagesSucceeded;
    if (r.scanStatus === "failed" || r.scanStatus === "partial") {
      const reason = (r.failureReason ?? {}) as { message?: unknown };
      problems.push(`${r.scanStatus === "failed" ? "The website could not be read" : "Part of the website could not be read"}${typeof reason.message === "string" ? `: ${reason.message}` : "."}`);
    }
    const li = ((r.socialLinks ?? {}) as { linkedin?: unknown }).linkedin;
    if (typeof li === "string") socials.push(li);
  }
  return { found: dedupe(found), problems, pagesSucceeded, linkedinLinks: socials };
}
const dedupe = (list: FoundEmail[]) => [...new Map(list.map(f => [f.email, f])).values()];

/**
 * The saved person a found address belongs to, when the address itself names them: its local part
 * must contain their first and last name, or the first name and last initial ("jane.d", "jdoe"
 * is not enough). Anything less stays a company contact marked as naming an unknown person.
 */
export function ownerOf(email: string, people: { id: string; fullName: string; firstName?: string | null; lastName?: string | null }[]): string | null {
  const local = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (local.length < 4) return null;
  const matches = people.filter(p => {
    const parts = personKey(p.fullName).split(" ").filter(Boolean);
    const first = (p.firstName ?? parts[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const last = (p.lastName ?? parts.at(-1) ?? "").toLowerCase().replace(/[^a-z]/g, "");
    if (first.length < 2 || last.length < 2 || first === last) return false;
    // Whole first and last name, or first name plus last initial ("jane.d" → "janed"). An initial
    // plus surname ("jdoe") fits too many people to assign.
    return (first.length >= 3 && last.length >= 3 && local.includes(first) && local.includes(last)) || local === `${first}${last[0]}`;
  });
  return matches.length === 1 ? matches[0].id : null; // two people who both fit: nobody gets it
}
