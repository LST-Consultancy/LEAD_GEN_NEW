import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { effectivePermissions } from "@/lib/auth/api-scopes";

/**
 * §65 — authenticating a machine caller.
 *
 * A key is stored as a SHA-256 digest, never in plaintext, exactly like a
 * session token. The prefix is kept so a key can be recognised in a list
 * without being reconstructable from it.
 *
 * The resulting context is an ordinary `AuthContext` with **narrowed
 * permissions**, so every service, every `mutate()` call and every tenant
 * check behaves identically whether the caller is a person or a key. There is
 * no separate machine code path to keep in sync — that is the whole point.
 */

const PREFIX = "sr_live_";

export type IssuedKey = { plaintext: string; prefix: string; keyHash: string };

/**
 * Mints a key. The plaintext is returned once and never stored, so this is the
 * only moment it exists anywhere.
 */
export function mintApiKey(): IssuedKey {
  const secret = randomBytes(24).toString("base64url");
  const plaintext = `${PREFIX}${secret}`;
  return {
    plaintext,
    // Enough to identify the key in a list, not enough to guess it.
    prefix: plaintext.slice(0, PREFIX.length + 4),
    keyHash: digest(plaintext),
  };
}

export function digest(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Reads a key from the request, accepting both conventional headers. */
export function readKeyFromHeaders(headers: Headers): string | null {
  const bearer = headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim() || null;
  }
  const direct = headers.get("x-api-key");
  return direct?.trim() || null;
}

export type ApiAuthFailure = {
  ok: false;
  status: 401 | 403;
  code: string;
  message: string;
};

export type ApiAuthSuccess = {
  ok: true;
  ctx: AuthContext;
  keyId: string;
  scopes: string[];
  /** Permissions the scopes asked for that the creator no longer has. */
  withheld: string[];
};

/**
 * Resolves a plaintext key to a scoped context, or explains the refusal.
 *
 * Every failure is a distinct, actionable message. "401 unauthorized" for a
 * revoked key, an expired key and a key whose creator was removed sends an
 * integrator looking in three wrong places.
 */
export async function authenticateApiKey(
  plaintext: string
): Promise<ApiAuthSuccess | ApiAuthFailure> {
  if (!plaintext.startsWith(PREFIX)) {
    return {
      ok: false,
      status: 401,
      code: "malformed_key",
      message: `An API key starts with "${PREFIX}". Send it as "Authorization: Bearer <key>" or "X-Api-Key: <key>".`,
    };
  }

  const hash = digest(plaintext);
  const key = await db.apiKey.findUnique({
    where: { keyHash: hash },
    include: {
      workspace: true,
    },
  });

  // Constant-time compare on the digest we just looked up, so a near-miss and
  // a miss take the same time.
  if (!key || !safeEqual(key.keyHash, hash)) {
    return {
      ok: false,
      status: 401,
      code: "unknown_key",
      message: "That key is not recognised. It may have been deleted.",
    };
  }
  if (key.revokedAt) {
    return {
      ok: false,
      status: 401,
      code: "revoked_key",
      message: `That key was revoked on ${key.revokedAt.toISOString().slice(0, 10)}. Issue a new one.`,
    };
  }
  if (key.expiresAt && key.expiresAt < new Date()) {
    return {
      ok: false,
      status: 401,
      code: "expired_key",
      message: `That key expired on ${key.expiresAt.toISOString().slice(0, 10)}. Issue a new one.`,
    };
  }
  if (key.workspace.deletedAt) {
    return {
      ok: false,
      status: 401,
      code: "workspace_gone",
      message: "The workspace this key belongs to no longer exists.",
    };
  }

  // The creator's *current* membership decides the ceiling. A key issued by
  // someone since removed or demoted must not keep their old authority.
  const member = key.createdById
    ? await db.workspaceMember.findFirst({
        where: {
          workspaceId: key.workspaceId,
          userId: key.createdById,
          deletedAt: null,
        },
        include: { role: true, user: true },
      })
    : null;

  if (!member) {
    return {
      ok: false,
      status: 403,
      code: "creator_removed",
      message:
        "The person who created this key is no longer a member of the workspace, so it has no authority. Ask a current member to issue a new key.",
    };
  }

  const { granted, withheld } = effectivePermissions(key.scopes, member.role.permissions);

  if (granted.length === 0) {
    return {
      ok: false,
      status: 403,
      code: "no_effective_scopes",
      message:
        "This key's scopes grant nothing, because the person who created it no longer holds the underlying permissions. Issue a new key from an account that does.",
    };
  }

  // Recorded on a successful authentication only, so `lastUsedAt` means "was
  // accepted", not "was attempted".
  await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });

  const ctx: AuthContext = {
    userId: member.userId,
    // No browser session. Audit rows carry the key instead, via actorLabel.
    sessionId: `apikey:${key.id}`,
    user: {
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      avatarUrl: member.user.avatarUrl,
      timezone: member.user.timezone,
    },
    workspaceId: key.workspaceId,
    workspace: {
      id: key.workspace.id,
      name: key.workspace.name,
      slug: key.workspace.slug,
      currency: key.workspace.currency,
      timezone: key.workspace.timezone,
      logoUrl: key.workspace.logoUrl,
      autopilotMode: key.workspace.autopilotMode,
      onboardedAt: key.workspace.onboardedAt,
    },
    memberId: member.id,
    roleKey: member.role.key,
    roleName: `${member.role.name} (via API key "${key.name}")`,
    // Narrowed: the intersection, never the union.
    permissions: granted,
    // A key cannot switch workspaces.
    workspaces: [],
  };

  return { ok: true, ctx, keyId: key.id, scopes: key.scopes, withheld };
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * The entry point an API route uses.
 *
 * Returns null when no key was presented at all, so a route can fall back to
 * the session. A *bad* key is a failure rather than an absence — falling back
 * to the session there would let a browser-authenticated request silently
 * succeed with a key its holder never had.
 */
export async function getApiContext(
  headers: Headers
): Promise<ApiAuthSuccess | ApiAuthFailure | null> {
  const plaintext = readKeyFromHeaders(headers);
  if (!plaintext) return null;
  return authenticateApiKey(plaintext);
}
