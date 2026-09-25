import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError } from "./mutate";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { encryptCredential, decryptCredential } from "@/lib/providers/credentials";
import { resolveRecipient, suppressionLookup } from "@/lib/outreach/recipient";
import * as google from "@/lib/calendar/google";

const KEY = "calendar";
const STATE_TTL_MS = 10 * 60_000;

function secret() { const s = process.env.AUTH_SECRET; if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters."); return s; }
/** OAuth `state`: who started the connection and a nonce also kept in an httpOnly cookie, signed so it cannot be forged or replayed into another account. */
export function signState(p: { workspaceId: string; userId: string; nonce: string; exp: number }) {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function readState(state: string) {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { workspaceId: string; userId: string; nonce: string; exp: number };
  return p.exp > Date.now() ? p : null;
}

export async function calendarStatus(ctx: AuthContext) {
  const row = await db.calendarConnection.findUnique({ where: { workspaceId_userId_provider: { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "google" } } });
  return toPlain({ configured: google.googleConfigured(), connected: Boolean(row && !row.revokedAt && row.encryptedTokens), email: row?.email ?? null, status: row?.status ?? null, lastError: row?.lastError ?? null, calendarId: row?.calendarId ?? "primary" });
}

/** The consent URL and the nonce the route stores in a cookie. Nothing is saved until Google answers. */
export function startGoogleConnect(ctx: AuthContext, redirectUri: string) {
  if (!google.googleConfigured()) throw new MutationError("Google sign-in for calendars is not set up on this server: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are needed, from an OAuth client registered in Google Cloud with this app's callback URL.", "not_configured", 422);
  const nonce = randomBytes(18).toString("base64url");
  return { url: google.authUrl(redirectUri, signState({ workspaceId: ctx.workspaceId, userId: ctx.userId, nonce, exp: Date.now() + STATE_TTL_MS })), nonce };
}

export async function completeGoogleConnect(ctx: AuthContext, raw: { code?: string | null; state?: string | null; error?: string | null; cookieNonce?: string | null; redirectUri: string }) {
  if (raw.error) throw new MutationError(raw.error === "access_denied" ? "Calendar access was not granted, so nothing was connected." : `Google returned an error (${raw.error}). Nothing was connected.`, "oauth_denied", 400);
  const state = raw.state ? readState(raw.state) : null;
  if (!state || !raw.code || !raw.cookieNonce || state.nonce !== raw.cookieNonce || state.userId !== ctx.userId || state.workspaceId !== ctx.workspaceId) throw new MutationError("This sign-in link is expired or was not started from this browser. Start again from Settings → Calendar.", "oauth_state", 400);
  const tokens = await google.exchangeCode(ctx.workspaceId, raw.code, raw.redirectUri);
  if (!google.GOOGLE_SCOPES.slice(0, 2).every(s => tokens.scopes.includes(s))) throw new MutationError("Google did not grant calendar event and free/busy access. Tick both boxes on Google's consent screen. Nothing was connected.", "scopes_missing", 422);
  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const data = { email: tokens.email, encryptedTokens: encryptCredential(JSON.stringify(tokens), ctx.workspaceId, KEY), scopes: tokens.scopes, status: "CONNECTED", lastError: null, revokedAt: null };
    const row = await db.calendarConnection.upsert({ where: { workspaceId_userId_provider: { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "google" } }, create: { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "google", ...data }, update: data });
    return { result: { email: row.email }, log: { action: "calendar.connected", objectType: "CalendarConnection", objectId: row.id, after: { provider: "google", email: row.email, scopes: row.scopes } } };
  });
}

export async function revokeCalendar(ctx: AuthContext) {
  const row = await db.calendarConnection.findUnique({ where: { workspaceId_userId_provider: { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "google" } } });
  if (!row || row.revokedAt) throw new MutationError("No calendar is connected.", "not_found", 404);
  let told = true;
  if (row.encryptedTokens) await google.revoke(ctx.workspaceId, JSON.parse(decryptCredential(row.encryptedTokens, ctx.workspaceId, KEY))).catch(() => { told = false; });
  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    await db.calendarConnection.update({ where: { id: row.id }, data: { encryptedTokens: null, status: "REVOKED", revokedAt: new Date() } });
    return { result: { note: told ? "Disconnected, and Google was told to revoke access. Events already created stay in your calendar." : "Disconnected here and the tokens are erased, but Google could not be reached to revoke access — remove it at myaccount.google.com/permissions." }, log: { action: "calendar.revoked", objectType: "CalendarConnection", objectId: row.id } };
  });
}

/** A user's live Google tokens, refreshed and saved when near expiry; null when not connected. */
async function tokensFor(workspaceId: string, userId: string | null) {
  if (!userId) return null;
  const row = await db.calendarConnection.findUnique({ where: { workspaceId_userId_provider: { workspaceId, userId, provider: "google" } } });
  if (!row?.encryptedTokens || row.revokedAt) return null;
  const current = JSON.parse(decryptCredential(row.encryptedTokens, workspaceId, KEY)) as google.GoogleTokens;
  try {
    const fresh = await google.refresh(workspaceId, current);
    if (fresh.accessToken !== current.accessToken) await db.calendarConnection.update({ where: { id: row.id }, data: { encryptedTokens: encryptCredential(JSON.stringify(fresh), workspaceId, KEY), status: "CONNECTED", lastError: null } });
    return { row, tokens: fresh };
  } catch (e) {
    await db.calendarConnection.update({ where: { id: row.id }, data: { status: "ERROR", lastError: e instanceof Error ? e.message : "Token refresh failed." } });
    return null;
  }
}

/** Busy periods in the signed-in user's calendar, for choosing a slot. */
export async function busyTimes(ctx: AuthContext, raw: unknown) {
  const { from, to } = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine(v => v.to > v.from && v.to.getTime() - v.from.getTime() <= 31 * 86400000, "Choose a range of up to 31 days.").parse(raw ?? {});
  const t = await tokensFor(ctx.workspaceId, ctx.userId);
  if (!t) return { connected: false as const, busy: [] };
  return toPlain({ connected: true as const, busy: await google.freeBusy(ctx.workspaceId, t.tokens, t.row.calendarId, from, to) });
}

type BookingLike = { id: string; hostUserId: string | null; leadId: string | null; title: string; startsAt: Date; endsAt: Date; timezone: string; location: string | null; meetingUrl: string | null; agenda: string | null; provider: string | null; externalId: string | null };
/** The lead's address to invite, chosen by the same rules as any send, or null (with why). */
async function invitee(workspaceId: string, leadId: string | null) {
  if (!leadId) return { email: null, why: "The meeting has no lead to invite." };
  const lead = await db.lead.findFirst({ where: { id: leadId, workspaceId }, select: { person: { select: { contactMethods: { where: { workspaceId, kind: { in: ["WORK_EMAIL", "PERSONAL_EMAIL"] } }, select: { value: true, optedOutAt: true, bounceCount: true }, orderBy: { kind: "asc" } } } } } });
  const rows = await db.suppression.findMany({ where: { workspaceId, kind: { in: ["email", "domain"] } }, select: { kind: true, value: true, reason: true, source: true } });
  const r = resolveRecipient(lead?.person.contactMethods ?? [], { listed: suppressionLookup(rows) });
  if (!r.toAddress || r.suppression) return { email: null, why: r.suppression ? `The lead cannot be invited: ${r.suppression.reason.toLowerCase()}.` : "The lead has no email address to invite." };
  return { email: r.toAddress, why: null };
}

/**
 * Creates, moves or cancels the booking's event in the host's Google Calendar. Never throws: the
 * booking is the record, and a calendar failure is reported beside it, not instead of it.
 */
export async function syncBookingEvent(workspaceId: string, booking: BookingLike, action: "create" | "move" | "cancel", opts: { invite?: boolean } = {}): Promise<{ synced: boolean; note: string; externalId?: string | null }> {
  const t = await tokensFor(workspaceId, booking.hostUserId);
  if (!t) return { synced: false, note: action === "create" ? "Recorded against the lead. The host has no calendar connected, so no event was created and no invite was sent." : action === "move" ? "Moved here. The host has no calendar connected, so nobody was told — let them know yourself." : "Cancelled here. The host has no calendar connected, so nobody was notified — tell them yourself." };
  try {
    if (action === "create") {
      const who = opts.invite ? await invitee(workspaceId, booking.leadId) : { email: null, why: null };
      const ev = await google.createEvent(workspaceId, t.tokens, t.row.calendarId, { ...booking, attendees: who.email ? [who.email] : [] }, Boolean(who.email));
      await db.booking.update({ where: { id: booking.id }, data: { provider: "google", externalId: ev.id } });
      return { synced: true, externalId: ev.id, note: `Added to ${t.row.email ?? "your"} Google Calendar${who.email ? `, and ${who.email} was invited` : ""}.${opts.invite && who.why ? ` ${who.why}` : ""}` };
    }
    if (booking.provider !== "google" || !booking.externalId) return { synced: false, note: action === "move" ? "Moved here. This meeting has no calendar event (it was recorded before the calendar was connected), so nothing else changed." : "Cancelled here. This meeting has no calendar event, so nothing else changed." };
    if (action === "move") { await google.patchEvent(workspaceId, t.tokens, t.row.calendarId, booking.externalId, booking, true); return { synced: true, note: "Moved, and the calendar event was updated; anyone invited was told." }; }
    await google.deleteEvent(workspaceId, t.tokens, t.row.calendarId, booking.externalId, true);
    return { synced: true, note: "Cancelled, and the calendar event was removed; anyone invited was told." };
  } catch {
    return { synced: false, note: `${action === "create" ? "Recorded" : action === "move" ? "Moved" : "Cancelled"} here, but Google Calendar could not be updated. Check the connection in Settings → Calendar and change the event there if needed.` };
  }
}
