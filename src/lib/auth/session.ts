import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";

const COOKIE_NAME = "sr_session";
const WORKSPACE_COOKIE = "sr_workspace";
const TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}

/**
 * The cookie carries a signed JWT; the DB stores only a SHA-256 of the raw
 * token so a database leak cannot be replayed as a login, and so sessions stay
 * individually revocable (§103).
 */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type SessionPayload = { sub: string; sid: string };

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ipAddress?: string; workspaceId?: string } = {}
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);

  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      workspaceId: meta.workspaceId ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt,
    },
  });

  const jwt = await new SignJWT({ sub: userId, sid: session.id, tok: raw })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return session.id;
}

export async function readSession(): Promise<{ userId: string; sessionId: string } | null> {
  const store = await cookies();
  const jwt = store.get(COOKIE_NAME)?.value;
  if (!jwt) return null;

  let claims: { sub?: string; sid?: string; tok?: string };
  try {
    const { payload } = await jwtVerify(jwt, secret());
    claims = payload as typeof claims;
  } catch {
    return null;
  }
  if (!claims.sub || !claims.sid || !claims.tok) return null;

  const session = await db.session.findUnique({ where: { id: claims.sid } });
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    session.userId !== claims.sub ||
    session.tokenHash !== hashToken(claims.tok)
  ) {
    return null;
  }

  return { userId: session.userId, sessionId: session.id };
}

export async function destroySession(): Promise<void> {
  const current = await readSession();
  if (current) {
    await db.session.update({
      where: { id: current.sessionId },
      data: { revokedAt: new Date() },
    });
  }
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_DAYS * 86_400,
  });
}

export async function readActiveWorkspace(): Promise<string | null> {
  const store = await cookies();
  return store.get(WORKSPACE_COOKIE)?.value ?? null;
}
