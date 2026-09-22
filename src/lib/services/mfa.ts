import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { recordAudit } from "@/lib/services/audit";
import { MutationError } from "@/lib/services/mutate";
import {
  generateRecoveryCodes,
  generateSecret,
  normaliseRecoveryCode,
  provisioningUri,
  verifyTotp,
} from "@/lib/auth/totp";

/**
 * §104 — second-factor enrolment.
 *
 * Three rules shape this:
 *
 *  1. **Enrolment is two steps.** A secret is stored, but `mfaEnabled` only
 *     flips once the user has proved their app produces the right code. A
 *     one-step enrolment locks out anyone who scanned the QR wrong, and they
 *     find out at their next sign-in.
 *  2. **Turning it off needs a factor**, not just a session. Otherwise a stolen
 *     session removes the very thing protecting against a stolen session.
 *  3. **Recovery codes are hashed** and shown exactly once. They are password
 *     equivalents — a database read must not yield a way past the second
 *     factor.
 *
 * Nothing here goes through `mutate()`: these are writes to the *user*, not to
 * tenant data, so a workspace permission is the wrong gate. They are audited
 * directly instead.
 */

export type MfaStatus = {
  enabled: boolean;
  enrolledAt: string | null;
  /** How many recovery codes are still unused. */
  recoveryCodesRemaining: number;
  /** True when a secret exists but was never confirmed — a half-finished setup. */
  pendingConfirmation: boolean;
};

export async function getMfaStatus(ctx: AuthContext): Promise<MfaStatus> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: {
      mfaEnabled: true,
      mfaSecret: true,
      mfaEnrolledAt: true,
      mfaRecoveryCodes: true,
    },
  });

  return {
    enabled: user.mfaEnabled,
    enrolledAt: user.mfaEnrolledAt?.toISOString() ?? null,
    recoveryCodesRemaining: user.mfaRecoveryCodes.length,
    pendingConfirmation: !user.mfaEnabled && user.mfaSecret !== null,
  };
}

/**
 * Step one: mint a secret and hand back what the app needs to scan.
 *
 * Deliberately does *not* enable anything. Calling it again before confirming
 * replaces the secret, which is what someone who closed the page mid-setup
 * needs — the half-scanned code from the first attempt stops working, and that
 * is correct.
 */
export async function beginMfaEnrolment(
  ctx: AuthContext
): Promise<{ secret: string; uri: string }> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { email: true, mfaEnabled: true },
  });

  if (user.mfaEnabled) {
    throw new MutationError(
      "Two-factor authentication is already on. Turn it off first if you want to move to a different device.",
      "already_enrolled",
      409
    );
  }

  const secret = generateSecret();
  await db.user.update({
    where: { id: ctx.userId },
    data: { mfaSecret: secret, mfaLastUsedStep: null },
  });

  await recordAudit(ctx, {
    action: "mfa.enrolment_started",
    objectType: "User",
    objectId: ctx.userId,
    actorType: "HUMAN",
  });

  return {
    secret,
    uri: provisioningUri({ secret, accountName: user.email, issuer: "Signalroom" }),
  };
}

const codeSchema = z.object({ code: z.string().trim().min(1).max(20) });

/**
 * Step two: prove the app works, then turn it on.
 *
 * Returns the recovery codes in plaintext — the only time they are ever
 * readable. Storing them hashed means this function cannot show them again,
 * which is the point.
 */
export async function confirmMfaEnrolment(
  ctx: AuthContext,
  raw: unknown
): Promise<{ recoveryCodes: string[] }> {
  const { code } = codeSchema.parse(raw);

  const user = await db.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { mfaSecret: true, mfaEnabled: true, mfaLastUsedStep: true },
  });

  if (user.mfaEnabled) {
    throw new MutationError("Two-factor authentication is already on.", "already_enrolled", 409);
  }
  if (!user.mfaSecret) {
    throw new MutationError(
      "There's no setup in progress. Start again to get a fresh QR code.",
      "no_enrolment",
      409
    );
  }

  const verdict = verifyTotp({
    secret: user.mfaSecret,
    code,
    lastUsedStep: user.mfaLastUsedStep,
  });
  if (!verdict.ok) {
    throw new MutationError(reasonFor(verdict.reason), "invalid_code", 400);
  }

  const recoveryCodes = generateRecoveryCodes();
  const hashed = await Promise.all(
    recoveryCodes.map((c) => hashPassword(normaliseRecoveryCode(c)))
  );

  await db.user.update({
    where: { id: ctx.userId },
    data: {
      mfaEnabled: true,
      mfaEnrolledAt: new Date(),
      mfaRecoveryCodes: hashed,
      mfaLastUsedStep: verdict.step,
    },
  });

  await recordAudit(ctx, {
    action: "mfa.enabled",
    objectType: "User",
    objectId: ctx.userId,
    after: { mfaEnabled: true, recoveryCodes: recoveryCodes.length },
    actorType: "HUMAN",
  });

  return { recoveryCodes };
}

/**
 * Turning it off requires a current code or a recovery code.
 *
 * A session alone is not enough: if a session is what an attacker has, letting
 * it disable the second factor removes exactly the protection that exists for
 * that case.
 */
export async function disableMfa(ctx: AuthContext, raw: unknown): Promise<{ disabled: true }> {
  const { code } = codeSchema.parse(raw);

  const user = await db.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { mfaEnabled: true, mfaSecret: true, mfaLastUsedStep: true, mfaRecoveryCodes: true },
  });

  if (!user.mfaEnabled || !user.mfaSecret) {
    throw new MutationError("Two-factor authentication isn't on.", "not_enrolled", 409);
  }

  const accepted = await acceptFactor(user, code);
  if (!accepted.ok) {
    throw new MutationError(accepted.message, "invalid_code", 400);
  }

  await db.user.update({
    where: { id: ctx.userId },
    data: {
      mfaEnabled: false,
      mfaSecret: null,
      mfaEnrolledAt: null,
      mfaRecoveryCodes: [],
      mfaLastUsedStep: null,
    },
  });

  await recordAudit(ctx, {
    action: "mfa.disabled",
    objectType: "User",
    objectId: ctx.userId,
    before: { mfaEnabled: true },
    after: { mfaEnabled: false },
    actorType: "HUMAN",
  });

  return { disabled: true };
}

/**
 * Checks a factor at sign-in, and spends it.
 *
 * Exported for the login route, which has no `AuthContext` yet — there is no
 * session until this passes.
 */
export async function verifySecondFactor(
  userId: string,
  code: string
): Promise<{ ok: true; usedRecoveryCode: boolean } | { ok: false; message: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { mfaEnabled: true, mfaSecret: true, mfaLastUsedStep: true, mfaRecoveryCodes: true },
  });

  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    return { ok: false, message: "Two-factor authentication isn't set up for this account." };
  }

  const accepted = await acceptFactor(user, code);
  if (!accepted.ok) return { ok: false, message: accepted.message };

  if (accepted.kind === "recovery") {
    // Spent, so it cannot be replayed. The remaining count is what the
    // settings screen warns on.
    await db.user.update({
      where: { id: userId },
      data: { mfaRecoveryCodes: accepted.remaining },
    });
    return { ok: true, usedRecoveryCode: true };
  }

  await db.user.update({ where: { id: userId }, data: { mfaLastUsedStep: accepted.step } });
  return { ok: true, usedRecoveryCode: false };
}

type FactorUser = {
  mfaSecret: string | null;
  mfaLastUsedStep: number | null;
  mfaRecoveryCodes: string[];
};

type FactorResult =
  | { ok: true; kind: "totp"; step: number }
  | { ok: true; kind: "recovery"; remaining: string[] }
  | { ok: false; message: string };

/**
 * A TOTP code first, then a recovery code.
 *
 * Both paths are tried on every attempt so the response does not reveal which
 * kind of code was expected, and the same message covers both failures.
 */
async function acceptFactor(user: FactorUser, code: string): Promise<FactorResult> {
  if (user.mfaSecret) {
    const verdict = verifyTotp({
      secret: user.mfaSecret,
      code,
      lastUsedStep: user.mfaLastUsedStep,
    });
    if (verdict.ok) return { ok: true, kind: "totp", step: verdict.step };
    if (verdict.reason === "replayed") {
      return {
        ok: false,
        message:
          "That code has already been used. Wait for your app to show the next one — a code only works once.",
      };
    }
  }

  const normalised = normaliseRecoveryCode(code);
  for (const [index, hash] of user.mfaRecoveryCodes.entries()) {
    if (await verifyPassword(normalised, hash)) {
      return {
        ok: true,
        kind: "recovery",
        remaining: user.mfaRecoveryCodes.filter((_, i) => i !== index),
      };
    }
  }

  return { ok: false, message: "That code isn't right. Check your authenticator app and try again." };
}

function reasonFor(reason: "malformed" | "mismatch" | "replayed"): string {
  if (reason === "malformed") return "A code is six digits. Check what your app is showing.";
  if (reason === "replayed") {
    return "That code has already been used. Wait for the next one.";
  }
  return "That code isn't right. If it keeps failing, your device's clock may be out of step.";
}
