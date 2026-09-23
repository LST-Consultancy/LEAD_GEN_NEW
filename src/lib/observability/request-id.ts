/**
 * §105 — request correlation.
 *
 * One id per request, attached in middleware, echoed on every response and
 * quoted in every error the user sees. It is the difference between "something
 * went wrong at about four o'clock" and a single line in a log.
 *
 * Pure, so it runs in edge middleware.
 */

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Uses the caller's id when it looks safe, and mints one otherwise.
 *
 * Honouring an inbound id lets a load balancer or an upstream service correlate
 * across hops. It is validated rather than trusted: the value is echoed into
 * response headers and log lines, so an unchecked one is a header-injection and
 * log-forging hole — a newline in it would let a caller write fake log entries.
 */
export function resolveRequestId(inbound: string | null): string {
  if (inbound && isWellFormed(inbound)) return inbound;
  return crypto.randomUUID();
}

/** Conservative: hex, dashes and underscores, bounded length. No whitespace. */
export function isWellFormed(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(value);
}
