import { z } from "zod";

/**
 * The contact-provider fallback: after the Apify stages, people who still have no address on the
 * company's domain are looked up in the workspace's own SignalHire, Hunter and Apollo accounts, in
 * the order set here, stopping for a person at the first provider that returns one. Pure — the
 * runner does the I/O. Off by default, because every lookup spends the workspace's provider credits.
 */
export const FALLBACK_PROVIDERS = ["signalhire", "hunter", "apollo"] as const;
export type FallbackProvider = typeof FALLBACK_PROVIDERS[number];
export const FALLBACK_LABEL: Record<FallbackProvider, string> = { signalhire: "SignalHire", hunter: "Hunter", apollo: "Apollo" };

export const fallbackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  order: z.array(z.enum(FALLBACK_PROVIDERS)).min(1).max(3).refine(o => new Set(o).size === o.length, "List each provider once.").default([...FALLBACK_PROVIDERS]),
  /** Provider lookups across all providers in one run; each lookup may spend one credit. */
  maxLookupsPerRun: z.number().int().min(1).max(50).default(5),
});
export type FallbackConfig = z.infer<typeof fallbackConfigSchema>;

export type LookupPerson = { personId: string; fullName: string; firstName: string | null; lastName: string | null; linkedinUrl: string | null; title: string | null; relevance: number };
export type LookupCompany = { name: string; domain: string | null };

/**
 * What each provider needs to look a person up at all, from its documented inputs. A provider that
 * cannot be asked is skipped with this reason, not called and billed for a guaranteed miss.
 */
export function inputsMissing(provider: FallbackProvider, p: LookupPerson, company: LookupCompany): string | null {
  const named = Boolean(p.firstName && p.lastName);
  switch (provider) {
    // The Person API takes a LinkedIn profile URL (or an email or phone, which is what is sought).
    case "signalhire": return p.linkedinUrl ? null : "SignalHire looks a person up by LinkedIn profile, and none is saved for them.";
    // Email Finder needs the domain (or company) and a first and last name.
    case "hunter": return company.domain ? (named ? null : "Hunter needs a first and last name.") : "Hunter needs the company's domain, which is not known yet.";
    // People Enrichment matches on a LinkedIn URL, or on a name plus the company's domain or name.
    case "apollo": return p.linkedinUrl || (named && (company.domain || company.name)) ? null : "Apollo needs a LinkedIn profile, or a full name with the company.";
  }
}

export type ProviderState = { provider: FallbackProvider; usable: boolean; why: string | null };
/** One provider's readiness from its connection row, checked the same way the connection screen does. */
export function providerState(provider: FallbackProvider, row: { enabled: boolean; allowedEnrichment: boolean; allowedStorage: boolean; hasKey: boolean; status: string } | null): ProviderState {
  const name = FALLBACK_LABEL[provider];
  if (!row) return { provider, usable: false, why: `${name} is not connected.` };
  if (!row.enabled) return { provider, usable: false, why: `${name} is disabled.` };
  if (!row.hasKey) return { provider, usable: false, why: `${name} has no API key saved.` };
  if (!row.allowedEnrichment || !row.allowedStorage) return { provider, usable: false, why: `${name} needs enrichment and storage rights confirmed.` };
  if (row.status === "ERROR") return { provider, usable: false, why: `${name}'s last connection test failed; test it again in Settings.` };
  return { provider, usable: true, why: null };
}

/** The people worth a paid lookup: most relevant first, capped so the run cannot exceed its lookups. */
export function whoToLookUp(people: LookupPerson[], haveAddress: Set<string>, max: number): LookupPerson[] {
  return people.filter(p => !haveAddress.has(p.personId)).sort((a, b) => b.relevance - a.relevance).slice(0, max);
}

/** Counts per provider, flattened so a stage's counts stay a flat record of numbers. */
export const countKey = (provider: FallbackProvider, what: "tried" | "found" | "skipped" | "failed") => `${provider}_${what}`;
