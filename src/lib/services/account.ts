import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/auth/password";
import { MutationError } from "./mutate";
import { recordAudit } from "./audit";

/**
 * A person's own account: profile, password, sessions. These belong to the
 * user rather than a workspace, so no workspace permission gates them — only
 * being signed in as that user. Each change is audited in the active workspace.
 */

const timezones = new Set(Intl.supportedValuesOf("timeZone"));

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Your name needs at least two characters.").max(120).optional(),
  timezone: z.string().trim().refine((tz) => timezones.has(tz) || tz === "UTC", "That isn't a timezone this app recognises.").optional(),
  locale: z.enum(["en-IN", "en-GB", "en-US", "hi-IN"]).optional(),
});

export async function updateProfile(ctx: AuthContext, raw: z.input<typeof profileSchema>) {
  const input = profileSchema.parse(raw);
  if (Object.keys(input).length === 0) throw new MutationError("Nothing to change.", "nothing_to_change", 400);
  const before = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true, timezone: true, locale: true } });
  const after = await db.user.update({ where: { id: ctx.userId }, data: input, select: { name: true, timezone: true, locale: true } });
  await recordAudit(ctx, { action: "account.profile_updated", objectType: "User", objectId: ctx.userId, before, after });
  return after;
}

const passwordSchema = z.object({
  current: z.string().min(1, "Enter your current password."),
  next: z.string().max(200),
  confirm: z.string().max(200),
});

/**
 * Changing the password signs out every other session — someone changing it
 * because they suspect a compromise needs the old sessions gone, not just the
 * old password. The current session stays so the person is not bounced out.
 */
export async function changePassword(ctx: AuthContext, raw: z.input<typeof passwordSchema>) {
  const input = passwordSchema.parse(raw);
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { passwordHash: true } });
  if (!user.passwordHash || !(await verifyPassword(input.current, user.passwordHash))) {
    throw new MutationError("That current password isn't right. Nothing was changed.", "wrong_password", 422);
  }
  if (input.next !== input.confirm) throw new MutationError("The new password and its confirmation don't match.", "mismatch", 422);
  const problems = passwordProblems(input.next);
  if (problems.length) throw new MutationError(problems.join(" "), "weak_password", 422);
  if (await verifyPassword(input.next, user.passwordHash)) throw new MutationError("That is your current password. Choose a different one.", "same_password", 422);

  await db.user.update({ where: { id: ctx.userId }, data: { passwordHash: await hashPassword(input.next) } });
  const revoked = await db.session.updateMany({ where: { userId: ctx.userId, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } });
  await recordAudit(ctx, { action: "account.password_changed", objectType: "User", objectId: ctx.userId, after: { otherSessionsSignedOut: revoked.count } });
  return { otherSessionsSignedOut: revoked.count };
}

/** Signs out one of your own sessions. Another user's session reads as not found. */
export async function revokeSession(ctx: AuthContext, sessionId: string) {
  const session = await db.session.findFirst({ where: { id: sessionId, userId: ctx.userId, revokedAt: null }, select: { id: true, userAgent: true } });
  if (!session) throw new MutationError("That session doesn't exist or is already signed out.", "not_found", 404);
  await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await recordAudit(ctx, { action: "account.session_revoked", objectType: "Session", objectId: session.id, after: { current: session.id === ctx.sessionId } });
  return { current: session.id === ctx.sessionId };
}

export async function revokeOtherSessions(ctx: AuthContext) {
  const r = await db.session.updateMany({ where: { userId: ctx.userId, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } });
  await recordAudit(ctx, { action: "account.sessions_revoked", objectType: "User", objectId: ctx.userId, after: { count: r.count } });
  return { count: r.count };
}
