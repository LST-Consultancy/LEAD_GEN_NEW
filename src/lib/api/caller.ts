import "server-only";
import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { getApiContext } from "@/lib/auth/api-key";
import { assertPermission } from "@/lib/auth/context";
import { SCOPE_INDEX } from "@/lib/auth/api-scopes";
import { apiError, unauthorized, type ApiErrorBody } from "@/lib/api/respond";
import type { NextResponse } from "next/server";

/**
 * Resolves whoever is calling — a browser session or an API key — into one
 * `AuthContext`.
 *
 * Routes use this instead of `getAuthContext()` so a machine caller runs
 * through exactly the same services, tenant scoping and permission checks as a
 * person. The only difference is that a key's permissions are narrowed to its
 * scopes, which the services then enforce for free.
 */
export type Caller =
  | { ok: true; ctx: AuthContext; via: "session" | "api_key"; scopes: string[] }
  | { ok: false; response: NextResponse<ApiErrorBody> };

export async function resolveCaller(
  headers: Headers,
  opts: { scope?: string } = {}
): Promise<Caller> {
  const viaKey = await getApiContext(headers);

  if (viaKey) {
    // A *bad* key is a failure, never a fall-through to the session. Falling
    // back would let a browser-authenticated request succeed with authority
    // the key never had.
    if (!viaKey.ok) {
      return { ok: false, response: apiError(viaKey.code, viaKey.message, viaKey.status) };
    }

    if (opts.scope && !viaKey.scopes.includes(opts.scope)) {
      const scope = SCOPE_INDEX.get(opts.scope);
      return {
        ok: false,
        response: apiError(
          "missing_scope",
          `This key does not hold the "${opts.scope}" scope${scope ? ` (${scope.label})` : ""}. Issue a key with that scope, or use one that has it.`,
          403
        ),
      };
    }

    return { ok: true, ctx: viaKey.ctx, via: "api_key", scopes: viaKey.scopes };
  }

  const session = await getAuthContext();
  if (!session) return { ok: false, response: unauthorized() };
  // A person is not scope-limited; their role already decides what they can do.
  return { ok: true, ctx: session, via: "session", scopes: [] };
}

/** Re-exported so routes need one import for the common case. */
export { assertPermission };
