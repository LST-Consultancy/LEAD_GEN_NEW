import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, setActiveWorkspace } from "@/lib/auth/session";
import { apiError, handleApiError, tooManyRequests } from "@/lib/api/respond";
import { verifySecondFactor } from "@/lib/services/mfa";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  /** A TOTP or recovery code, sent on the second request once one is asked for. */
  mfaCode: z.string().trim().max(20).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { email, password, mfaCode } = schema.parse(await req.json());

    // Keyed on both the address and the source, and *both* must pass. On the
    // address alone, one attacker with a botnet still gets unlimited guesses at
    // one account; on the source alone, a distributed attack on many accounts
    // costs nothing. The address is already known to whoever is guessing it, so
    // using it as a key reveals nothing new.
    for (const [name, key, noun] of [
      ["login", `email:${email}`, "sign-in attempts for this account"],
      ["login", `ip:${clientKey(req.headers)}`, "sign-in attempts"],
    ] as const) {
      const limit = await rateLimit(name, key);
      if (!limit.allowed) return tooManyRequests(limit.resetSeconds, noun);
    }

    const user = await db.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { deletedAt: null },
          orderBy: [{ isDefault: "desc" }, { joinedAt: "asc" }],
          take: 1,
        },
      },
    });

    // Identical message and comparable work for both branches, so the response
    // does not reveal whether an account exists.
    if (!user || !user.passwordHash || user.deletedAt) {
      await verifyPassword(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");
      return apiError("invalid_credentials", "That email and password don't match.", 401);
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return apiError("invalid_credentials", "That email and password don't match.", 401);
    }

    // Password is right. If a second factor is enrolled it must be satisfied
    // before any session exists — checked here rather than after `createSession`
    // so a half-authenticated request never holds a usable cookie.
    if (user.mfaEnabled) {
      if (!mfaCode) {
        return apiError(
          "mfa_required",
          "Enter the six-digit code from your authenticator app.",
          401,
          { mfaRequired: true }
        );
      }
      const factor = await verifySecondFactor(user.id, mfaCode);
      if (!factor.ok) {
        return apiError("invalid_code", factor.message, 401, { mfaRequired: true });
      }
    }

    if (user.memberships.length === 0) {
      return apiError(
        "no_workspace",
        "Your account isn't attached to a workspace yet. Ask whoever invited you to resend the invitation.",
        403
      );
    }

    const workspaceId = user.memberships[0].workspaceId;
    await createSession(user.id, {
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      workspaceId,
    });
    await setActiveWorkspace(workspaceId);

    return NextResponse.json({ ok: true, redirectTo: "/today" });
  } catch (err) {
    return handleApiError(err);
  }
}
