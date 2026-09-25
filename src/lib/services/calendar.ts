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
import * as microsoft from "@/lib/calendar/microsoft";

export type CalendarProvider = "google" | "microsoft";
const LABEL: Record<CalendarProvider, string> = { google: "Google Calendar", microsoft: "Outlook calendar" };

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

/** The signed-in user's calendar connection, whichever provider it is through. */
async function connectionOf(workspaceId: string, userId: string) {
  return db.calendarConnection.findFirst({ where: { workspaceId, userId, provider: { in: ["google", "microsoft"] }, revokedAt: null, encryptedTokens: { not: null } }, orderBy: { updatedAt: "desc" } });
}

export async function calendarStatus(ctx: AuthContext) {
  const row = await connectionOf(ctx.workspaceId, ctx.userId);
  return toPlain({ configured: google.googleConfigured(), microsoftConfigured: microsoft.microsoftConfigured(), connected: Boolean(row), provider: (row?.provider ?? null) as CalendarProvider | null, email: row?.email ?? null, status: row?.status ?? null, lastError: row?.lastError ?? null, calendarId: row?.calendarId ?? "primary" });
}

/** The consent URL and the nonce the route stores in a cookie. Nothing is saved until Google answers. */
export function startGoogleConnect(ctx: AuthContext, redirectUri: string) {
  if (!google.googleConfigured()) throw new MutationError("Google sign-in for calendars is not set up on this server: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are needed, from an OAuth client registered in Google Cloud with this app's callback URL.", "not_configured", 422);
  const nonce = randomBytes(18).toString("base64url");
  return { url: google.authUrl(redirectUri, signState({ workspaceId: ctx.workspaceId, userId: ctx.userId, nonce, exp: Date.now() + STATE_TTL_MS })), nonce };
}

export function startMicrosoftConnect(ctx: AuthContext, redirectUri: string) {
  if (!microsoft.microsoftConfigured()) throw new MutationError("Microsoft sign-in for calendars is not set up on this server: MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET are needed, from an Entra ID app registration with the Calendars.ReadWrite delegated permission and this app's callback URL.", "not_configured", 422);
  const nonce = randomBytes(18).toString("base64url");
  return { url: microsoft.authUrl(redirectUri, signState({ workspaceId: ctx.workspaceId, userId: ctx.userId, nonce, exp: Date.now() + STATE_TTL_MS })), nonce };
}

/** Finishes a Microsoft sign-in; one calendar per person, so any Google connection is replaced. */
export async function completeMicrosoftConnect(ctx: AuthContext, raw: { code?: string | null; state?: string | null; error?: string | null; cookieNonce?: string | null; redirectUri: string }) {
  if (raw.error) throw new MutationError(raw.error === "access_denied" ? "Calendar access was not granted, so nothing was connected." : `Microsoft returned an error (${raw.error}). Nothing was connected.`, "oauth_denied", 400);
  const state = raw.state ? readState(raw.state) : null;
  if (!state || !raw.code || !raw.cookieNonce || state.nonce !== raw.cookieNonce || state.userId !== ctx.userId || state.workspaceId !== ctx.workspaceId) throw new MutationError("This sign-in link is expired or was not started from this browser. Start again from Settings → Calendar.", "oauth_state", 400);
  const tokens = await microsoft.exchangeCode(ctx.workspaceId, raw.code, raw.redirectUri);
  if (!tokens.scopes.some(s => /Calendars\.ReadWrite$/i.test(s))) throw new MutationError("Microsoft did not grant calendar access. Accept the calendar permission on the consent screen. Nothing was connected.", "scopes_missing", 422);
  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    await db.calendarConnection.updateMany({ where: { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "google", revokedAt: null }, data: { status: "REVOKED", revokedAt: new Date(), encryptedTokens: null } });
    const data = { email: tokens.email, encryptedTokens: encryptCredential(JSON.stringify(tokens), ctx.workspaceId, KEY), scopes: tokens.scopes, status: "CONNECTED", lastError: null, revokedAt: null, calendarId: "primary" };
    const row = await db.calendarConnection.upsert({ where: { workspaceId_userId_provider: { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "microsoft" } }, create: { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "microsoft", ...data }, update: data });
    return { result: { email: row.email }, log: { action: "calendar.connected", objectType: "CalendarConnection", objectId: row.id, after: { provider: "microsoft", email: row.email, scopes: row.scopes } } };
  });
}

export async function completeGoogleConnect(ctx: AuthContext, raw: { code?: string | null; state?: string | null; error?: string | null; cookieNonce?: string | null; redirectUri: string }) {
  if (raw.error) throw new MutationError(raw.error === "access_denied" ? "Calendar access was not granted, so nothing was connected." : `Google returned an error (${raw.error}). Nothing was connected.`, "oauth_denied", 400);
  const state = raw.state ? readState(raw.state) : null;
  if (!state || !raw.code || !raw.cookieNonce || state.nonce !== raw.cookieNonce || state.userId !== ctx.userId || state.workspaceId !== ctx.workspaceId) throw new MutationError("This sign-in link is expired or was not started from this browser. Start again from Settings → Calendar.", "oauth_state", 400);
  const tokens = await google.exchangeCode(ctx.workspaceId, raw.code, raw.redirectUri);
  if (!google.GOOGLE_SCOPES.slice(0, 2).every(s => tokens.scopes.includes(s))) throw new MutationError("Google did not grant calendar event and free/busy access. Tick both boxes on Google's consent screen. Nothing was connected.", "scopes_missing", 422);
  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    await db.calendarConnection.updateMany({ where: { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "microsoft", revokedAt: null }, data: { status: "REVOKED", revokedAt: new Date(), encryptedTokens: null } });
    const data = { email: tokens.email, encryptedTokens: encryptCredential(JSON.stringify(tokens), ctx.workspaceId, KEY), scopes: tokens.scopes, status: "CONNECTED", lastError: null, revokedAt: null };
    const row = await db.calendarConnection.upsert({ where: { workspaceId_userId_provider: { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "google" } }, create: { workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "google", ...data }, update: data });
    return { result: { email: row.email }, log: { action: "calendar.connected", objectType: "CalendarConnection", objectId: row.id, after: { provider: "google", email: row.email, scopes: row.scopes } } };
  });
}

export async function revokeCalendar(ctx: AuthContext) {
  const row = await connectionOf(ctx.workspaceId, ctx.userId);
  if (!row) throw new MutationError("No calendar is connected.", "not_found", 404);
  let told = row.provider === "google";
  if (row.provider === "google" && row.encryptedTokens) await google.revoke(ctx.workspaceId, JSON.parse(decryptCredential(row.encryptedTokens, ctx.workspaceId, KEY))).catch(() => { told = false; });
  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    await db.calendarConnection.update({ where: { id: row.id }, data: { encryptedTokens: null, status: "REVOKED", revokedAt: new Date() } });
    const note = row.provider === "microsoft"
      ? "Disconnected here and the tokens are erased. Microsoft has no per-app revoke call — remove the app's access at myaccount.microsoft.com → Apps if you no longer want it granted. Events already created stay in your calendar."
      : told ? "Disconnected, and Google was told to revoke access. Events already created stay in your calendar." : "Disconnected here and the tokens are erased, but Google could not be reached to revoke access — remove it at myaccount.google.com/permissions.";
    return { result: { note }, log: { action: "calendar.revoked", objectType: "CalendarConnection", objectId: row.id, after: { provider: row.provider } } };
  });
}

/** A user's live Google tokens, refreshed and saved when near expiry; null when not connected. */
async function tokensFor(workspaceId: string, userId: string | null) {
  if (!userId) return null;
  const row = await connectionOf(workspaceId, userId);
  if (!row?.encryptedTokens) return null;
  const current = JSON.parse(decryptCredential(row.encryptedTokens, workspaceId, KEY)) as google.GoogleTokens;
  const provider = row.provider as CalendarProvider;
  try {
    const fresh = await (provider === "microsoft" ? microsoft.refresh : google.refresh)(workspaceId, current);
    if (fresh.accessToken !== current.accessToken) await db.calendarConnection.update({ where: { id: row.id }, data: { encryptedTokens: encryptCredential(JSON.stringify(fresh), workspaceId, KEY), status: "CONNECTED", lastError: null } });
    return { row, provider, tokens: fresh };
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
  const busy = t.provider === "microsoft" ? await microsoft.freeBusy(ctx.workspaceId, t.tokens, t.row.email ?? ctx.user.email, from, to) : await google.freeBusy(ctx.workspaceId, t.tokens, t.row.calendarId, from, to);
  return toPlain({ connected: true as const, busy });
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
export async function syncBookingEvent(workspaceId: string, booking: BookingLike, action: "create" | "move" | "cancel", opts: { invite?: boolean } = {}): Promise<{ synced: boolean; note: string; externalId?: string | null; provider?: CalendarProvider }> {
  const t = await tokensFor(workspaceId, booking.hostUserId);
  if (!t) return { synced: false, note: action === "create" ? "Recorded against the lead. The host has no calendar connected, so no event was created and no invite was sent." : action === "move" ? "Moved here. The host has no calendar connected, so nobody was told — let them know yourself." : "Cancelled here. The host has no calendar connected, so nobody was notified — tell them yourself." };
  const label = `${t.row.email ?? "your"} ${LABEL[t.provider]}`;
  try {
    if (action === "create") {
      const who = opts.invite ? await invitee(workspaceId, booking.leadId) : { email: null, why: null };
      const input = { ...booking, attendees: who.email ? [who.email] : [] };
      const ev = t.provider === "microsoft" ? await microsoft.createEvent(workspaceId, t.tokens, input, Boolean(who.email)) : await google.createEvent(workspaceId, t.tokens, t.row.calendarId, input, Boolean(who.email));
      await db.booking.update({ where: { id: booking.id }, data: { provider: t.provider, externalId: ev.id } });
      return { synced: true, externalId: ev.id, provider: t.provider, note: `Added to ${label}${who.email ? `, and ${who.email} was invited` : ""}.${opts.invite && who.why ? ` ${who.why}` : ""}` };
    }
    if (booking.provider !== t.provider || !booking.externalId) return { synced: false, note: action === "move" ? `Moved here. This meeting has no event in the connected calendar (it was recorded before it was connected, or in another calendar), so nothing else changed.` : "Cancelled here. This meeting has no event in the connected calendar, so nothing else changed." };
    if (action === "move") {
      if (t.provider === "microsoft") await microsoft.patchEvent(workspaceId, t.tokens, booking.externalId, booking);
      else await google.patchEvent(workspaceId, t.tokens, t.row.calendarId, booking.externalId, booking, true);
      return { synced: true, note: "Moved, and the calendar event was updated; anyone invited was told." };
    }
    if (t.provider === "microsoft") await microsoft.deleteEvent(workspaceId, t.tokens, booking.externalId);
    else await google.deleteEvent(workspaceId, t.tokens, t.row.calendarId, booking.externalId, true);
    return { synced: true, note: "Cancelled, and the calendar event was removed; anyone invited was told." };
  } catch {
    return { synced: false, note: `${action === "create" ? "Recorded" : action === "move" ? "Moved" : "Cancelled"} here, but ${LABEL[t.provider]} could not be updated. Check the connection in Settings → Calendar and change the event there if needed.` };
  }
}
