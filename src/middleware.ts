import { NextResponse, type NextRequest } from "next/server";
import { checkOrigin, configuredHosts } from "@/lib/security/origin";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { buildCsp, hstsValue, newNonce, shouldSendHsts } from "@/lib/security/csp";

/**
 * §103 — cross-site request forgery, refused before a route runs.
 *
 * This sits in middleware rather than in each route so a new route is
 * protected by existing, not by remembering. It is deliberately I/O-free:
 * middleware runs on the edge runtime, and anything touching the database or
 * Redis here would either fail to build or add a hop to every request.
 *
 * Rate limiting is *not* here for that reason — it needs a store, so it lives
 * in `lib/security/rate-limit.ts` and is applied in the routes that warrant it.
 */
const CSP_HEADER = "Content-Security-Policy";

export function middleware(req: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";

  // One id per request, minted here because middleware is the only place every
  // request passes through. Forwarded to the route so its logs correlate, and
  // echoed to the client so a support report can quote it.
  const requestId = resolveRequestId(req.headers.get(REQUEST_ID_HEADER));

  const verdict = checkOrigin({
    method: req.method,
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    host: req.headers.get("host"),
    hasApiKey:
      req.headers.has("x-api-key") || Boolean(req.headers.get("authorization")?.startsWith("Bearer ")),
    allowedHosts: configuredHosts(process.env.APP_ALLOWED_HOSTS),
  });

  if (verdict.ok) {
    const headers = new Headers(req.headers);
    headers.set(REQUEST_ID_HEADER, requestId);

    // The nonce must reach Next *on the request*: it reads the CSP header from
    // the incoming headers and stamps the nonce onto the inline scripts it
    // generates. Setting it only on the response would leave those scripts
    // unnonced, and the policy would block the app's own hydration.
    const nonce = newNonce();
    const csp = buildCsp({ nonce, isDev });
    headers.set("x-nonce", nonce);
    headers.set(CSP_HEADER, csp);

    const res = NextResponse.next({ request: { headers } });
    res.headers.set(REQUEST_ID_HEADER, requestId);
    res.headers.set(CSP_HEADER, csp);
    if (shouldSendHsts({ proto: req.headers.get("x-forwarded-proto"), isDev })) {
      res.headers.set("Strict-Transport-Security", hstsValue());
    }
    return res;
  }

  // Same shape as every other API error, so a client that already handles
  // `error.code` does not need a special case for this one. The id is included
  // because a refused write is exactly the thing someone reports.
  const res = NextResponse.json(
    { error: { code: verdict.code, message: verdict.reason, requestId } },
    { status: 403 }
  );
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

export const config = {
  /**
   * Only paths that can change something. Static assets and image optimisation
   * are excluded because running this on every asset request costs more than
   * it protects — they are GETs, which the check passes anyway.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
