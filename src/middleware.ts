import { NextResponse, type NextRequest } from "next/server";
import { checkOrigin, configuredHosts } from "@/lib/security/origin";

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
export function middleware(req: NextRequest) {
  const verdict = checkOrigin({
    method: req.method,
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    host: req.headers.get("host"),
    hasApiKey:
      req.headers.has("x-api-key") || Boolean(req.headers.get("authorization")?.startsWith("Bearer ")),
    allowedHosts: configuredHosts(process.env.APP_ALLOWED_HOSTS),
  });

  if (verdict.ok) return NextResponse.next();

  // Same shape as every other API error, so a client that already handles
  // `error.code` does not need a special case for this one.
  return NextResponse.json(
    { error: { code: verdict.code, message: verdict.reason } },
    { status: 403 }
  );
}

export const config = {
  /**
   * Only paths that can change something. Static assets and image optimisation
   * are excluded because running this on every asset request costs more than
   * it protects — they are GETs, which the check passes anyway.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
