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
  /** Paid lookups across every run in 24 hours, so runs started together cannot each spend a full run's allowance. */
  maxLookupsPerDay: z.number().int().min(1).max(500).default(25),
  /** Free calls in one run (Hunter Domain Finder, Apollo People Search, SignalHire Search) — they spend quotas, not credits. */
  maxFreeCallsPerRun: z.number().int().min(0).max(50).default(6),
  /**
   * Which operations may use a fallback provider at all. An operation switched off here is not
   * reached through any provider — turning off verification means nobody verifies.
   */
  operations: z.object({ company: z.boolean().default(true), people: z.boolean().default(true), emails: z.boolean().default(true), verify: z.boolean().default(true) }).default({ company: true, people: true, emails: true, verify: true }),
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

// ── Whether a person already has a usable address (D05) ─────────────────────────────────────────

/** An existing address as the database holds it. */
export type ExistingAddress = { value: string | null; verificationResult: string; verifiedAt: Date | string | null; optedOutAt: Date | string | null; bounceCount: number; status: string };
/**
 * What to do for one person, and why — shown beside them, so "not searched" always has a reason.
 * - `search`: no usable address — look one up (none on file, or the one on file is known-bad);
 * - `skip`: an address on file is good enough, or is unconfirmed but not known-bad (check it,
 *   don't replace it — catch-all and unknown are not invalid);
 * - `recheck`: a confirmed address whose check is stale — verify again, don't rediscover;
 * - `blocked`: the person or their address is suppressed — never look up another way to reach them.
 */
export type AddressDecision = { action: "search" | "skip" | "recheck" | "blocked"; reason: string };
const UNCONFIRMED_LABEL: Record<string, string> = { UNCHECKED: "not yet checked", SYNTAX_VALID: "format-valid only", DOMAIN_VALID: "domain accepts mail, mailbox unconfirmed", CATCH_ALL: "on a catch-all domain", INCONCLUSIVE: "check was inconclusive", UNKNOWN: "check returned no result" };
export const BOUNCE_LIMIT = 3;

export function addressDecision(contacts: ExistingAddress[], opts: { onCompany: (email: string) => boolean; isRole: (email: string) => boolean; suppressed: Set<string>; personSuppressed: boolean; verifyCacheDays: number; now?: Date }): AddressDecision {
  const now = (opts.now ?? new Date()).getTime();
  if (opts.personSuppressed) return { action: "blocked", reason: "On the do-not-contact list, so no address is looked up for them." };
  // A person-specific requirement is only met by a personal address on the company's own domain.
  const own = contacts.filter(c => c.value && opts.onCompany(c.value) && !opts.isRole(c.value));
  const optedOut = own.find(c => c.optedOutAt || opts.suppressed.has(c.value!.toLowerCase()));
  if (optedOut) return { action: "blocked", reason: `Their address ${optedOut.value} is suppressed or opted out, so no replacement is looked up — that would work around their choice.` };
  const bad = (c: ExistingAddress) => c.verificationResult === "INVALID" || c.bounceCount >= BOUNCE_LIMIT || c.status === "FAILED";
  const fresh = (c: ExistingAddress) => Boolean(c.verifiedAt) && now - new Date(c.verifiedAt!).getTime() <= opts.verifyCacheDays * 86400000;
  const confirmed = own.filter(c => c.verificationResult === "MAILBOX_CONFIRMED" && !bad(c));
  const good = confirmed.find(fresh);
  if (good) return { action: "skip", reason: `Has a confirmed address (${good.value}).` };
  const unconfirmed = own.find(c => !bad(c) && c.verificationResult !== "MAILBOX_CONFIRMED");
  if (unconfirmed) return { action: "skip", reason: `Has an address that is ${UNCONFIRMED_LABEL[unconfirmed.verificationResult] ?? unconfirmed.verificationResult.toLowerCase()} (${unconfirmed.value}). Check it rather than replace it — that is not the same as invalid.` };
  const stale = confirmed[0];
  if (stale) return { action: "recheck", reason: `Confirmed address ${stale.value} was last checked over ${opts.verifyCacheDays} days ago — due for a recheck, not a replacement.` };
  const invalid = own.find(bad);
  if (invalid) return { action: "search", reason: `The address on file (${invalid.value}) is ${invalid.bounceCount >= BOUNCE_LIMIT ? "bouncing" : "invalid"} — looking for a replacement.` };
  const other = contacts.find(c => c.value && !own.includes(c));
  return { action: "search", reason: other ? `Only ${opts.isRole(other.value!) ? "a role address" : "an address off the company's domain"} is on file (${other.value}), which does not reach them personally.` : "No address on the company's domain." };
}
