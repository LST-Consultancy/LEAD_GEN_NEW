import "server-only";
import type { FallbackProvider, LookupCompany, LookupPerson } from "@/lib/enrichment/fallback";
import { ProviderRequestError } from "./provider-errors";
import { signalHireProvider } from "./signalhire";
import { hunterProvider } from "./hunter";
import { apolloProvider } from "./apollo";

/** Addresses one provider returned for one person, with the provider's own words about them — never a verification of ours. */
export type LookupResult = { emails: { email: string; status: string | null; confidence: number | null; ref: string | null }[]; note?: string };

/**
 * One person looked up at one provider. Throws with a sentence a person can act on when the
 * provider refused (quota, key, rate limit); returns an empty list when it simply had nothing.
 */
export async function lookupContact(provider: FallbackProvider, workspaceId: string, apiKey: string, p: LookupPerson, company: LookupCompany): Promise<LookupResult> {
  try {
    if (provider === "signalhire") {
      const r = await signalHireProvider(workspaceId, apiKey).lookupByLinkedIn(p.linkedinUrl!);
      if (r.status === "credits_are_over") throw new ProviderRequestError("SignalHire has no credits left. Nothing more was looked up there.", "http", 402);
      if (!r.candidate) return { emails: [], note: r.status === "success" ? undefined : `no match (${r.status.replaceAll("_", " ")}).` };
      // Work emails, and emails SignalHire did not label; personal addresses are not requested for B2B contact.
      const emails = (r.candidate.contacts ?? []).filter(c => c.type === "email" && c.subType !== "personal").map(c => ({ email: c.value.trim().toLowerCase(), status: c.subType ?? null, confidence: c.rating ?? null, ref: `signalhire:${r.candidate!.uid}` }));
      return { emails };
    }
    if (provider === "hunter") {
      const r = await hunterProvider(workspaceId, apiKey).findEmailDetailed(company.domain!, p.firstName!, p.lastName!);
      return { emails: r.email ? [{ email: r.email.toLowerCase(), status: r.verification ?? (r.acceptAll ? "accept_all" : null), confidence: r.score, ref: "hunter:email-finder" }] : [] };
    }
    const r = await apolloProvider(workspaceId, apiKey).matchPerson(p, company);
    if (!r.person || r.confidence === "none") return { emails: [], note: r.person ? "matched nobody with confidence." : undefined };
    const email = r.person.email && !/^email_not_unlocked@/i.test(r.person.email) ? r.person.email.toLowerCase() : null;
    if (!email || r.person.email_status === "unavailable") return { emails: [], note: "found the person but no email." };
    return { emails: [{ email, status: r.person.email_status ?? null, confidence: r.confidence === "high" ? 90 : r.confidence === "medium" ? 60 : r.confidence === "low" ? 30 : null, ref: r.person.id ? `apollo:${r.person.id}` : "apollo:match" }], note: r.confidence === "low" ? "low-confidence match; check the person before using the address." : undefined };
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      if (provider === "hunter" && error.status === 451) return { emails: [], note: "this person has asked Hunter not to process their data." };
      if (error.status === 401 || error.status === 403) throw new Error("the API key was refused; test the connection in Settings.");
      if (error.status === 402 || error.status === 429) throw new Error("quota or credits are used up; nothing more was looked up there.");
      throw new Error(error.message);
    }
    throw new Error("the answer could not be read.");
  }
}
