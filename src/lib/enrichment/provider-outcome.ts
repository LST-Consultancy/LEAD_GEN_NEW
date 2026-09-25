/**
 * Why a fallback provider call did not produce a result, kept as distinct outcomes because each
 * needs a different fix and a different next step. Pure.
 *
 * | outcome             | means                                   | next provider? | fix                        |
 * |---------------------|-----------------------------------------|----------------|----------------------------|
 * | found               | a usable result                         | stop (enough)  | —                          |
 * | review              | a result whose identity is not proven   | yes            | a person decides           |
 * | no_match            | the provider looked and had nothing     | yes            | —                          |
 * | unsupported         | the provider cannot do this operation   | yes            | —                          |
 * | missing_input       | it can, but needs an input we lack      | yes            | find the input first       |
 * | invalid_credentials | the key was refused                     | yes            | re-enter the key           |
 * | not_entitled        | the plan does not include this          | yes            | upgrade or use another     |
 * | quota               | credits or usage limit exhausted        | yes            | top up / wait for reset    |
 * | rate_limited        | too many requests just now              | yes            | retry later                |
 * | transient           | network, timeout or server error        | yes            | retry later                |
 * | not_connected       | not connected, disabled or no rights    | yes            | connect it                 |
 * | malformed           | response no longer matches the docs     | yes            | the adapter needs updating |
 * | cached              | asked recently; not asked again         | yes            | "Run again" to re-ask      |
 * | interrupted         | a call started but its answer was lost  | yes            | "Run again" to re-ask      |
 * | budget              | this run's or today's lookup cap is used| no             | raise the cap              |
 * | cancelled           | the run was cancelled                   | no             | —                          |
 */
export const OUTCOMES = ["found", "review", "no_match", "unsupported", "missing_input", "not_connected", "invalid_credentials", "not_entitled", "quota", "rate_limited", "transient", "malformed", "cached", "interrupted", "budget", "cancelled"] as const;
export type Outcome = typeof OUTCOMES[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  found: "found", review: "held for review", no_match: "no match", unsupported: "not supported", missing_input: "missing an input",
  invalid_credentials: "key refused", not_entitled: "not on this plan", quota: "credits or quota used up", rate_limited: "rate-limited",
  transient: "temporary failure", budget: "lookup limit reached", cancelled: "cancelled",
  not_connected: "not connected", malformed: "unexpected response", cached: "asked recently", interrupted: "interrupted",
};
/** Outcomes that stop the whole operation rather than moving to the next provider. */
export const STOPS_OPERATION: Outcome[] = ["found", "budget", "cancelled"];
/** Outcomes that mean the provider was actually called (and may have spent a credit). */
export const WAS_CALLED: Outcome[] = ["found", "review", "no_match", "invalid_credentials", "not_entitled", "quota", "rate_limited", "transient", "malformed"];
/** Outcomes that are not repeated inside the freshness window: the provider already answered. */
export const TERMINAL_ANSWERS: Outcome[] = ["found", "review", "no_match"];

type ErrorLike = { status?: number | null; kind?: string; providerCode?: string | null; message?: string };

/**
 * A provider's HTTP failure as an outcome, from the status code and the provider's own error id.
 * Documented codes: Hunter 401 invalid key, 403 `rate_limit` (per-second limit) vs other 403s,
 * 429 usage limit exceeded; Apollo 401, 403 (master key or plan), 422, 429 rate limit; SignalHire
 * 401, 402 out of credits or search quota, 406 validation, 429.
 */
export function classifyProviderError(provider: "signalhire" | "hunter" | "apollo", e: ErrorLike): { outcome: Outcome; detail: string } {
  const s = e.status ?? null; const code = (e.providerCode ?? "").toLowerCase();
  if (e.kind === "network" || (s !== null && s >= 500)) return { outcome: "transient", detail: "The provider could not be reached or had a server error." };
  if (e.kind === "busy") return { outcome: "transient", detail: "Another request to this provider was in progress." };
  if (s === 401) return { outcome: "invalid_credentials", detail: "The API key was refused. Re-enter it in Settings → Lead Sources & APIs." };
  if (s === 402) return { outcome: "quota", detail: provider === "signalhire" ? "SignalHire has no credits (or search quota) left." : "The account has no credits left." };
  if (s === 403) {
    // Hunter documents 403 as "You have reached the rate limit"; its only plan-scoped 403 is for Discover.
    if (provider === "hunter") return code.includes("no_") ? { outcome: "not_entitled", detail: "Hunter's plan does not include this endpoint." } : { outcome: "rate_limited", detail: "Hunter's per-second rate limit was hit." };
    if (provider === "apollo") return { outcome: "not_entitled", detail: code.includes("inaccessible") || code.includes("access_denied") ? "This Apollo key does not include this endpoint in its scope — issue a key that does, or a master key." : "Apollo refused this for the account's plan (paid plans only)." };
    return { outcome: "not_entitled", detail: "SignalHire refused this: the account is disabled, or this API is not enabled for it." };
  }
  if (s === 429) {
    if (provider === "hunter") return { outcome: "quota", detail: "Hunter's monthly usage limit is exceeded." };
    return { outcome: "rate_limited", detail: "The provider is rate-limiting this account." };
  }
  if (e.kind === "rate_limited") return { outcome: "rate_limited", detail: "This workspace's own request limit for the provider was reached." };
  if (s === 404) return { outcome: "no_match", detail: "The provider had no record for this." };
  if (s === 451) return { outcome: "no_match", detail: "This person has asked the provider not to process their data." };
  if (s === 400 || s === 406 || s === 422) return { outcome: "missing_input", detail: "The provider rejected the request as incomplete." };
  return { outcome: "transient", detail: `The provider refused the request${s ? ` (HTTP ${s})` : ""}.` };
}
