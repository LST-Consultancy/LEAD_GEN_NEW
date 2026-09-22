import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate } from "@/lib/services/mutate";
import { mintApiKey } from "@/lib/auth/api-key";
import {
  API_SCOPES,
  SCOPE_INDEX,
  effectivePermissions,
  grantableScopes,
  highestRisk,
  requiredPermissions,
} from "@/lib/auth/api-scopes";
import { endpointsForScopes, ENDPOINTS, KEY_ENDPOINTS } from "@/lib/api/manifest";

/**
 * §65 — managing machine credentials.
 *
 * The plaintext exists for exactly one response and is never stored, so
 * "shown once, never again" is a property of the data model rather than a
 * promise the UI makes.
 */

export async function listApiKeys(ctx: AuthContext) {
  const keys = await db.apiKey.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
  });

  const creatorIds = [...new Set(keys.map((k) => k.createdById).filter((id): id is string => !!id))];
  const members = creatorIds.length
    ? await db.workspaceMember.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          userId: { in: creatorIds },
          // Must match `authenticateApiKey` exactly. Without this filter the
          // list called a key "active" while authentication refused it as
          // orphaned — the screen and the gate disagreeing about whether a
          // credential works.
          deletedAt: null,
        },
        include: { user: { select: { id: true, name: true } }, role: true },
      })
    : [];
  const byUser = new Map(members.map((m) => [m.userId, m]));

  const now = new Date();

  return keys.map((k) => {
    const creator = k.createdById ? byUser.get(k.createdById) : undefined;
    const { granted, withheld } = creator
      ? effectivePermissions(k.scopes, creator.role.permissions)
      : { granted: [], withheld: [] };

    const expired = k.expiresAt !== null && k.expiresAt < now;
    /**
     * The state that matters is whether the key *works*, which is not the
     * same as whether it was revoked. An unrevoked key can be dead because it
     * expired, because its creator left, or because their role no longer
     * carries the permissions its scopes need.
     */
    const state = k.revokedAt
      ? "revoked"
      : expired
        ? "expired"
        : !creator
          ? "orphaned"
          : granted.length === 0
            ? "powerless"
            : "active";

    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes.map((s) => ({
        key: s,
        label: SCOPE_INDEX.get(s)?.label ?? s,
        risk: SCOPE_INDEX.get(s)?.risk ?? null,
        known: SCOPE_INDEX.has(s),
      })),
      highestRisk: highestRisk(k.scopes),
      state,
      stateReason:
        state === "revoked"
          ? `Revoked on ${k.revokedAt!.toISOString().slice(0, 10)}.`
          : state === "expired"
            ? `Expired on ${k.expiresAt!.toISOString().slice(0, 10)}.`
            : state === "orphaned"
              ? "The person who created it is no longer a member, so it has no authority."
              : state === "powerless"
                ? "Its creator no longer holds the permissions these scopes need, so it can do nothing."
                : null,
      creatorName: creator?.user.name ?? null,
      creatorRole: creator?.role.name ?? null,
      /** Permissions its scopes ask for that the creator no longer has. */
      withheld,
      endpointCount: endpointsForScopes(k.scopes).length,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    };
  });
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Give the key a name you will recognise later.").max(80),
  scopes: z.array(z.string()).min(1, "A key with no scopes could do nothing.").max(20),
  /** Days until expiry, or null for a key that never expires. */
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(90),
});

export type ApiKeyInput = z.input<typeof createSchema>;

export async function createApiKey(ctx: AuthContext, raw: ApiKeyInput) {
  const input = createSchema.parse(raw);

  const unknown = input.scopes.filter((s) => !SCOPE_INDEX.has(s));
  if (unknown.length > 0) {
    throw new MutationError(
      `${unknown.map((s) => `"${s}"`).join(", ")} ${unknown.length === 1 ? "is not a scope" : "are not scopes"} this app defines.`,
      "unknown_scope",
      422
    );
  }

  // A key can never exceed its creator. Checked against each scope's
  // *minimum*: a rep holding only `view_own` may still issue a read key, which
  // the visibility filter then scopes to their own leads. Refused at creation
  // rather than silently narrowed, so nobody hands out a key believing it does
  // more than it does.
  const missing = requiredPermissions(input.scopes).filter((p) => !ctx.permissions.includes(p));
  if (missing.length > 0) {
    const blocking = input.scopes.filter((s) =>
      (SCOPE_INDEX.get(s)?.requires ?? []).some((p) => missing.includes(p))
    );
    throw new MutationError(
      `Your role cannot grant ${blocking.map((s) => `"${s}"`).join(", ")}. A key can never do more than the person who created it, so this would produce a key that does not work.`,
      "scope_exceeds_role",
      403
    );
  }

  const clash = await db.apiKey.findFirst({
    where: { workspaceId: ctx.workspaceId, name: input.name, revokedAt: null },
    select: { id: true },
  });
  if (clash) {
    throw new MutationError(
      "A live key already has that name. Names are how you tell them apart when revoking one.",
      "duplicate_name",
      409
    );
  }

  const minted = mintApiKey();

  return mutate(ctx, PERMISSIONS.API_KEYS_MANAGE, async () => {
    const key = await db.apiKey.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        prefix: minted.prefix,
        keyHash: minted.keyHash,
        scopes: input.scopes,
        createdById: ctx.userId,
        expiresAt:
          input.expiresInDays === null
            ? null
            : new Date(Date.now() + input.expiresInDays * 86_400_000),
      },
    });

    return {
      result: {
        key: toPlain({
          id: key.id,
          name: key.name,
          prefix: key.prefix,
          scopes: key.scopes,
          expiresAt: key.expiresAt,
        }),
        /**
         * The only time this exists. It is not stored, so it cannot be shown
         * again — the UI has to say that before the user navigates away.
         */
        plaintext: minted.plaintext,
        endpoints: endpointsForScopes(input.scopes),
        note:
          input.expiresInDays === null
            ? "Copy it now. It is stored as a hash, so this is the only time it can be shown — and it never expires, which means revoking is the only way to stop it."
            : `Copy it now. It is stored as a hash, so this is the only time it can be shown. It expires in ${input.expiresInDays} days.`,
      },
      log: {
        action: "api_key.created",
        objectType: "ApiKey",
        objectId: key.id,
        after: { name: input.name, scopes: input.scopes, expiresAt: key.expiresAt },
        activity: {
          kind: "api_key.created",
          summary: `API key "${input.name}" created with ${input.scopes.length} ${input.scopes.length === 1 ? "scope" : "scopes"}`,
        },
      },
    };
  });
}

export async function revokeApiKey(ctx: AuthContext, id: string) {
  const key = await loadScoped(
    () =>
      db.apiKey.findFirst({ where: { id, workspaceId: ctx.workspaceId } }),
    "That key"
  );

  if (key.revokedAt) {
    throw new MutationError(
      `That key was already revoked on ${key.revokedAt.toISOString().slice(0, 10)}.`,
      "already_revoked",
      409
    );
  }

  return mutate(ctx, PERMISSIONS.API_KEYS_MANAGE, async () => {
    const updated = await db.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    return {
      result: {
        key: toPlain(updated),
        note: key.lastUsedAt
          ? `Revoked. It stops working immediately — anything using it since ${key.lastUsedAt.toISOString().slice(0, 10)} will start failing.`
          : "Revoked. It stops working immediately, and it was never used.",
      },
      log: {
        action: "api_key.revoked",
        objectType: "ApiKey",
        objectId: id,
        before: { name: key.name, lastUsedAt: key.lastUsedAt },
        after: { revoked: true },
        activity: {
          kind: "api_key.revoked",
          summary: `API key "${key.name}" revoked`,
        },
      },
    };
  });
}

/** Everything the API Keys screen needs to describe the surface honestly. */
export function getApiSurface(ctx: AuthContext) {
  return {
    scopes: grantableScopes(ctx.permissions).map(({ scope, grantable, missing }) => ({
      ...scope,
      grantable,
      missing,
      endpoints: endpointsForScopes([scope.key]).length,
    })),
    endpoints: ENDPOINTS,
    keyEndpointCount: KEY_ENDPOINTS.length,
    totalEndpointCount: ENDPOINTS.length,
    allScopes: API_SCOPES.length,
  };
}
