/**
 * §103 — cross-site request forgery.
 *
 * The session lives in an httpOnly cookie with `SameSite=Lax`, which already
 * stops a cross-site `POST` carrying it. That is *most* of the protection, and
 * it is why there is no token threaded through every form here. It is not all
 * of it:
 *
 *  - Chrome's "Lax + POST" mitigation still sends a cookie on a cross-site
 *    top-level POST for the first two minutes after it is set, which is
 *    exactly the window right after someone signs in.
 *  - `SameSite` treats every subdomain as the same site, so anything hosted on
 *    a sibling subdomain is trusted by the cookie and not by us.
 *  - A browser that does not implement `SameSite` defaults to sending it.
 *
 * So every state-changing request must also prove where it came from. This is
 * a header comparison with no I/O, which keeps it runnable in edge middleware
 * and cheap enough to sit in front of everything.
 *
 * Pure and dependency-free so it can be tested directly.
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type OriginVerdict =
  | { ok: true; reason: "not_mutating" | "same_origin" | "machine_caller" }
  | { ok: false; code: "missing_origin" | "cross_origin"; reason: string };

/**
 * Decides whether a request may proceed.
 *
 * `allowedHosts` is the set this deployment answers on — normally just the
 * request's own `Host`, but a proxy that rewrites it needs the real one
 * configured, or every write would be refused.
 */
export function checkOrigin(input: {
  method: string;
  origin: string | null;
  referer: string | null;
  host: string | null;
  /** Present when the caller authenticated with an API key rather than a cookie. */
  hasApiKey: boolean;
  allowedHosts?: string[];
}): OriginVerdict {
  if (!MUTATING.has(input.method.toUpperCase())) {
    return { ok: true, reason: "not_mutating" };
  }

  // An API key is sent in a header the browser cannot add cross-origin without
  // a preflight this server never approves, and it arrives without a cookie.
  // Forgery is not the threat model there — a stolen key is, and that is the
  // key's own lifecycle problem.
  if (input.hasApiKey) {
    return { ok: true, reason: "machine_caller" };
  }

  const allowed = new Set(
    [...(input.allowedHosts ?? []), input.host].filter((h): h is string => Boolean(h)).map(normalise)
  );

  // `Origin` is sent on every cross-origin request and on same-origin
  // state-changing ones in every current browser. `Referer` is the fallback
  // for the handful of cases that strip it.
  const claimed = hostOf(input.origin) ?? hostOf(input.referer);

  if (!claimed) {
    return {
      ok: false,
      code: "missing_origin",
      reason:
        "This request carried no Origin or Referer, so where it came from can't be established. Nothing was changed.",
    };
  }

  if (!allowed.has(normalise(claimed))) {
    return {
      ok: false,
      code: "cross_origin",
      reason:
        "This request came from another site, so it was refused. Nothing was changed. If you are using this app through a proxy, its host needs to be in APP_ALLOWED_HOSTS.",
    };
  }

  return { ok: true, reason: "same_origin" };
}

/** Hosts are compared case-insensitively and without a trailing dot. */
function normalise(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

/**
 * The host of a URL, or null when there isn't one.
 *
 * `Origin: null` is a real value — a sandboxed iframe or a redirected
 * cross-origin POST sends it — and it must not be read as "no origin header",
 * which would let it through the missing-origin branch.
 */
function hostOf(value: string | null): string | null {
  if (!value || value === "null") return null;
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

/** Hosts this deployment answers on, beyond the request's own. */
export function configuredHosts(env: string | undefined): string[] {
  if (!env) return [];
  return env
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}
