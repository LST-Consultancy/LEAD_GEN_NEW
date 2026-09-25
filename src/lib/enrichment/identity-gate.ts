import { personKey } from "@/lib/opportunities/authority";
import { nameSimilarity } from "./identity";
import { profileKeyOf } from "./people";

/**
 * Is the person a provider returned the person we asked about? Pure. Three things are kept apart,
 * because each is proven differently and each can fail on its own:
 * - identity — is this the same human (profile id/URL, name, employer);
 * - ownership — does the address belong to them (a provider's association, a name pattern);
 * - verification — does the mailbox accept mail (a separate check, never inferred here).
 *
 * An address agreeing with the company's domain says nothing about *which* person it belongs to,
 * so it never counts as identity evidence.
 */
export type IdentityLevel = "confirmed" | "supported" | "weak" | "conflict";
export type IdentityVerdict = { level: IdentityLevel; attach: boolean; reasons: string[] };

export type Requested = { fullName: string; firstName?: string | null; lastName?: string | null; linkedinUrl?: string | null; company: { name: string; domain: string | null; aliases?: string[]; linkedinUrl?: string | null } };
export type Returned = {
  fullName?: string | null; firstName?: string | null; lastName?: string | null;
  linkedinUrl?: string | null;
  employer?: { name?: string | null; domain?: string | null; linkedinUrl?: string | null; current?: boolean | null } | null;
  /** The provider's own match confidence, when it gives one. */
  providerConfidence?: "high" | "medium" | "low" | "none" | null;
  /** The provider was asked for exactly this profile (SignalHire by LinkedIn URL). */
  askedByProfile?: boolean;
};

const clean = (s: string | null | undefined) => (s ?? "").trim();
const hostOf = (u: string | null | undefined) => { try { return u ? new URL(u.startsWith("http") ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, "") : null; } catch { return null; } };
const slugOf = (u: string | null | undefined) => (u ? /linkedin\.com\/company\/([^/?#]+)/i.exec(u)?.[1]?.toLowerCase() ?? null : null);

function namesAgree(a: Requested, b: Returned): boolean | null {
  const bn = clean(b.fullName) || [clean(b.firstName), clean(b.lastName)].filter(Boolean).join(" ");
  if (!bn) return null;
  if (personKey(bn) === personKey(a.fullName)) return true;
  const [af, al] = [clean(a.firstName) || a.fullName.split(/\s+/)[0], clean(a.lastName) || a.fullName.split(/\s+/).slice(-1)[0]].map(x => x.toLowerCase());
  const parts = bn.toLowerCase().split(/\s+/);
  return parts[0] === af && parts[parts.length - 1] === al;
}

function employerAgrees(a: Requested, b: Returned): boolean | null {
  const e = b.employer; if (!e) return null;
  if (e.current === false) return false;
  const slugA = slugOf(a.company.linkedinUrl), slugB = slugOf(e.linkedinUrl);
  if (slugA && slugB) return slugA === slugB;
  const host = hostOf(e.domain);
  const own = [a.company.domain, ...(a.company.aliases ?? [])].filter(Boolean) as string[];
  if (host && own.length) return own.some(d => host === d || host.endsWith(`.${d}`));
  if (clean(e.name)) return nameSimilarity(a.company.name, e.name!) !== "different";
  return null;
}

export function checkIdentity(asked: Requested, got: Returned): IdentityVerdict {
  const reasons: string[] = [];
  const keyA = profileKeyOf(asked.linkedinUrl ?? null), keyB = profileKeyOf(got.linkedinUrl ?? null);
  const lowConfidence = got.providerConfidence === "low" || got.providerConfidence === "none";
  // Being asked for a profile counts as the profile only when the provider stands behind its match;
  // a low-confidence answer to a profile lookup is a guess about someone else as often as not.
  const profile = keyA && keyB ? keyA === keyB : got.askedByProfile && keyA && !lowConfidence ? true : null;
  const names = namesAgree(asked, got);
  const employer = employerAgrees(asked, got);
  if (profile === false) reasons.push("The provider's LinkedIn profile is a different one from the person on file.");
  if (names === false) reasons.push(`The provider's person is named ${clean(got.fullName) || [got.firstName, got.lastName].filter(Boolean).join(" ")}, not ${asked.fullName}.`);
  if (employer === false) reasons.push(`The provider places them at ${clean(got.employer?.name) || hostOf(got.employer?.domain) || "another company"}, not ${asked.company.name}${got.employer?.current === false ? " (or not currently)" : ""}.`);
  if (profile === false || names === false || employer === false) return { level: "conflict", attach: false, reasons };
  if (profile === true) { reasons.push(got.askedByProfile && !keyB ? "Returned for the exact LinkedIn profile on file." : "Same LinkedIn profile as the person on file."); return { level: "confirmed", attach: true, reasons }; }
  if (lowConfidence) { reasons.push(`The provider rates its own match ${got.providerConfidence}.`); return { level: "weak", attach: false, reasons }; }
  if (names === true && employer === true) { reasons.push("Same name, and the provider places them at this company."); return { level: "supported", attach: true, reasons }; }
  if (names === true) reasons.push("Same name, but the provider does not say where they work.");
  else reasons.push("The provider does not give a name to compare.");
  return { level: "weak", attach: false, reasons };
}
