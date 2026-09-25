import "server-only";
import { z } from "zod";
import { providerJson } from "@/lib/providers/http";

/**
 * Google Calendar through OAuth 2.0 (web server flow) and the Calendar v3 API.
 * - Consent: https://accounts.google.com/o/oauth2/v2/auth with access_type=offline for a refresh token.
 * - Tokens:  POST https://oauth2.googleapis.com/token (form-encoded), refresh with grant_type=refresh_token.
 * - Revoke:  POST https://oauth2.googleapis.com/revoke?token=…
 * - Free/busy: POST https://www.googleapis.com/calendar/v3/freeBusy
 * - Events:  POST/PATCH/DELETE https://www.googleapis.com/calendar/v3/calendars/{id}/events[/{eventId}]
 *   with sendUpdates=all|none — invitations go out only when a person asks for them.
 * Only the two scopes needed are requested: events and free/busy, never full calendar access.
 */
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy", "openid", "email"];
const P = "google_calendar";
const API = "https://www.googleapis.com/calendar/v3";

export type GoogleTokens = { accessToken: string; refreshToken: string | null; expiresAt: number; email: string | null };
export const googleConfigured = () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
const client = () => ({ id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "", secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "" });

export function authUrl(redirectUri: string, state: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [k, v] of Object.entries({ client_id: client().id, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE_SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state })) u.searchParams.set(k, v);
  return u.toString();
}

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number(), refresh_token: z.string().optional(), scope: z.string().optional(), id_token: z.string().optional() });
/** The email in an ID token's payload; the token came straight from Google over TLS, so it is read, not verified again. */
const emailOf = (idToken?: string) => { try { return idToken ? (JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string }).email ?? null : null; } catch { return null; } };

export async function exchangeCode(workspaceId: string, code: string, redirectUri: string): Promise<GoogleTokens & { scopes: string[] }> {
  const t = tokenSchema.parse(await providerJson(workspaceId, P, "https://oauth2.googleapis.com/token", {}, { code, client_id: client().id, client_secret: client().secret, redirect_uri: redirectUri, grant_type: "authorization_code" }, { form: true }));
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: Date.now() + t.expires_in * 1000, email: emailOf(t.id_token), scopes: (t.scope ?? "").split(" ").filter(Boolean) };
}
export async function refresh(workspaceId: string, tokens: GoogleTokens): Promise<GoogleTokens> {
  if (tokens.expiresAt - Date.now() > 60_000) return tokens;
  if (!tokens.refreshToken) throw new Error("The calendar connection has expired and has no refresh token. Connect it again.");
  const t = tokenSchema.parse(await providerJson(workspaceId, P, "https://oauth2.googleapis.com/token", {}, { refresh_token: tokens.refreshToken, client_id: client().id, client_secret: client().secret, grant_type: "refresh_token" }, { form: true }));
  return { ...tokens, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
}
export async function revoke(workspaceId: string, tokens: GoogleTokens) {
  const token = tokens.refreshToken ?? tokens.accessToken;
  await providerJson(workspaceId, P, `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {}, { token }, { form: true });
}

const auth = (t: GoogleTokens) => ({ Authorization: `Bearer ${t.accessToken}` });
export async function freeBusy(workspaceId: string, t: GoogleTokens, calendarId: string, from: Date, to: Date) {
  const r = z.object({ calendars: z.record(z.string(), z.object({ busy: z.array(z.object({ start: z.string(), end: z.string() })).default([]), errors: z.array(z.unknown()).optional() })) }).parse(await providerJson(workspaceId, P, `${API}/freeBusy`, auth(t), { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: calendarId }] }));
  return (r.calendars[calendarId]?.busy ?? []).map(b => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export type EventInput = { title: string; startsAt: Date; endsAt: Date; timezone: string; location?: string | null; meetingUrl?: string | null; agenda?: string | null; attendees: string[] };
export function eventBody(e: EventInput) {
  return {
    summary: e.title,
    description: [e.agenda, e.meetingUrl ? `Join: ${e.meetingUrl}` : null].filter(Boolean).join("\n\n") || undefined,
    location: e.location ?? e.meetingUrl ?? undefined,
    start: { dateTime: e.startsAt.toISOString(), timeZone: e.timezone },
    end: { dateTime: e.endsAt.toISOString(), timeZone: e.timezone },
    attendees: e.attendees.map(email => ({ email })),
    reminders: { useDefault: true },
  };
}
const eventSchema = z.object({ id: z.string(), htmlLink: z.string().optional() });
const q = (invite: boolean) => `sendUpdates=${invite ? "all" : "none"}`;
export async function createEvent(workspaceId: string, t: GoogleTokens, calendarId: string, e: EventInput, invite: boolean) {
  return eventSchema.parse(await providerJson(workspaceId, P, `${API}/calendars/${encodeURIComponent(calendarId)}/events?${q(invite)}`, auth(t), eventBody(e) as Record<string, unknown>));
}
export async function patchEvent(workspaceId: string, t: GoogleTokens, calendarId: string, eventId: string, patch: Partial<EventInput>, invite: boolean) {
  const body: Record<string, unknown> = {};
  if (patch.startsAt && patch.endsAt && patch.timezone) { body.start = { dateTime: patch.startsAt.toISOString(), timeZone: patch.timezone }; body.end = { dateTime: patch.endsAt.toISOString(), timeZone: patch.timezone }; }
  if (patch.title) body.summary = patch.title;
  return eventSchema.parse(await providerJson(workspaceId, P, `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${q(invite)}`, auth(t), body, { method: "PATCH" }));
}
export async function deleteEvent(workspaceId: string, t: GoogleTokens, calendarId: string, eventId: string, invite: boolean) {
  await providerJson(workspaceId, P, `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${q(invite)}`, auth(t), undefined, { method: "DELETE" });
}
