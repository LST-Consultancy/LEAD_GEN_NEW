/**
 * §103 — Content-Security-Policy and HSTS.
 *
 * A CSP is the one security header that fails *silently and locally*: a wrong
 * directive does not error in CI, it blanks a chart in somebody's browser. So
 * this is built as a pure function over an explicit set of inputs, tested
 * directly, and then checked in a real browser by `e2e/csp.spec.ts`, which
 * fails on any violation the console reports.
 *
 * The policy is nonce-based rather than hash- or `unsafe-inline`-based. Next
 * injects inline scripts to hand hydration data to the client; `unsafe-inline`
 * would permit those *and* anything an injection managed to add, which is most
 * of what a CSP exists to stop.
 */

export type CspOptions = {
  /** Per-request, base64. Next applies it to its own scripts. */
  nonce: string;
  /**
   * Development needs `unsafe-eval` — the dev server's hot reloading compiles
   * modules at runtime. Shipping that to production would undo a good part of
   * the policy, so it is keyed off the environment rather than a flag someone
   * could leave on.
   */
  isDev: boolean;
  /** Extra origins a deployment genuinely calls, e.g. an analytics endpoint. */
  extraConnectSrc?: string[];
};

export function buildCsp(opts: CspOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${opts.nonce}'`,
    // `strict-dynamic` lets a nonced script load the chunks it needs without
    // enumerating every filename, which is the only workable shape for a
    // bundler that content-hashes its output.
    "'strict-dynamic'",
    // Ignored by browsers that understand `strict-dynamic`; a fallback for
    // those that do not, rather than a loosening for those that do.
    "https:",
    ...(opts.isDev ? ["'unsafe-eval'"] : []),
  ];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // Inline styles cannot be nonced here: Next and the chart components set
    // `style` attributes directly, and an attribute carries no nonce. This is
    // the one concession, and it is narrow — a style injection can deface a
    // page but cannot execute.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    // The push service worker is this app's own file. Without this, workers fall back to
    // script-src, where `strict-dynamic` ignores 'self' and registration would be refused.
    "worker-src": ["'self'"],
    "connect-src": ["'self'", ...(opts.extraConnectSrc ?? []), ...(opts.isDev ? ["ws:", "wss:"] : [])],
    // Nothing here is embedded and nothing embeds others.
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    // Stops a `<base>` tag rewriting every relative URL on the page.
    "base-uri": ["'self'"],
    // Forms post to this app only; a stolen form action is how a phished
    // credential leaves.
    "form-action": ["'self'"],
  };

  const parts = Object.entries(directives).map(([key, values]) => `${key} ${values.join(" ")}`);

  // Upgrading insecure requests only makes sense once there is TLS to upgrade
  // to. In development everything is http://localhost and this would break it.
  if (!opts.isDev) parts.push("upgrade-insecure-requests");

  return parts.join("; ");
}

/**
 * HTTP Strict Transport Security.
 *
 * Returned only for a request that actually arrived over HTTPS. Sending it over
 * plain HTTP is ignored by browsers at best, and setting it from a local dev
 * server would pin `localhost` to HTTPS in the developer's browser — which
 * breaks every other project on that machine and is not obvious to undo.
 *
 * Two years, with subdomains, and preload-eligible. `includeSubDomains` is the
 * part to think about before deploying: it commits every subdomain to HTTPS.
 */
export function hstsValue(): string {
  return "max-age=63072000; includeSubDomains; preload";
}

export function shouldSendHsts(opts: { proto: string | null; isDev: boolean }): boolean {
  if (opts.isDev) return false;
  return opts.proto === "https";
}

/** A fresh nonce. Base64 so it is safe inside a header value. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
