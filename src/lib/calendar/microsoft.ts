import "server-only";
import { z } from "zod";
import { providerJson } from "@/lib/providers/http";
import type { EventInput, GoogleTokens } from "./google";

/**
 * Microsoft 365 / Outlook calendars through the Microsoft identity platform (authorization-code
 * flow, delegated permissions) and Microsoft Graph v1.0, per the Graph documentation (checked
 * 2026-09-25):
 * - Consent: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize, scopes
 *   offline_access Calendars.ReadWrite User.Read — events in the user's own calendar, nothing else.
 * - Tokens:  POST …/oauth2/v2.0/token (form-encoded); refresh tokens rotate.
 * - Free/busy: POST https://graph.microsoft.com/v1.0/me/calendar/getSchedule
 * - Events:  POST /me/events, PATCH /me/events/{id}, DELETE /me/events/{id}. Graph sends the
 *   invitation, update or cancellation to attendees itself; an event with no attendees notifies
 *   nobody, which is how "don't invite" is honoured.
 * There is no per-app revoke endpoint; a user removes the grant at myaccount.microsoft.com.
 */
export const MICROSOFT_SCOPES = ["offline_access", "https://graph.microsoft.com/Calendars.ReadWrite", "https://graph.microsoft.com/User.Read", "openid", "email"];
const P = "microsoft_calendar";
const API = "https://graph.microsoft.com/v1.0/me";
const tenant = () => process.env.MICROSOFT_OAUTH_TENANT || "common";
const client = () => ({ id: process.env.MICROSOFT_OAUTH_CLIENT_ID ?? "", secret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET ?? "" });
export const microsoftConfigured = () => Boolean(client().id && client().secret);

export function authUrl(redirectUri: string, state: string) {
  const u = new URL(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`);
  for (const [k, v] of Object.entries({ client_id: client().id, redirect_uri: redirectUri, response_type: "code", response_mode: "query", scope: MICROSOFT_SCOPES.join(" "), prompt: "select_account", state })) u.searchParams.set(k, v);
  return u.toString();
}
const tokenUrl = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;
const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number(), refresh_token: z.string().optional(), scope: z.string().optional(), id_token: z.string().optional() });
const emailOf = (idToken?: string) => { try { if (!idToken) return null; const c = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string; preferred_username?: string }; return c.email ?? c.preferred_username ?? null; } catch { return null; } };

export async function exchangeCode(workspaceId: string, code: string, redirectUri: string): Promise<GoogleTokens & { scopes: string[] }> {
  const t = tokenSchema.parse(await providerJson(workspaceId, P, tokenUrl(), {}, { code, client_id: client().id, client_secret: client().secret, redirect_uri: redirectUri, grant_type: "authorization_code", scope: MICROSOFT_SCOPES.join(" ") }, { form: true }));
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: Date.now() + t.expires_in * 1000, email: emailOf(t.id_token), scopes: (t.scope ?? "").split(" ").filter(Boolean) };
}
export async function refresh(workspaceId: string, tokens: GoogleTokens): Promise<GoogleTokens> {
  if (tokens.expiresAt - Date.now() > 60_000) return tokens;
  if (!tokens.refreshToken) throw new Error("The calendar connection has expired and has no refresh token. Connect it again.");
  const t = tokenSchema.parse(await providerJson(workspaceId, P, tokenUrl(), {}, { refresh_token: tokens.refreshToken, client_id: client().id, client_secret: client().secret, grant_type: "refresh_token", scope: MICROSOFT_SCOPES.join(" ") }, { form: true }));
  return { ...tokens, accessToken: t.access_token, refreshToken: t.refresh_token ?? tokens.refreshToken, expiresAt: Date.now() + t.expires_in * 1000 };
}

const auth = (t: GoogleTokens) => ({ Authorization: `Bearer ${t.accessToken}` });
/** Graph returns schedule times without an offset in the zone asked for; UTC is asked for. */
const utc = (s: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);

export async function freeBusy(workspaceId: string, t: GoogleTokens, email: string, from: Date, to: Date) {
  const r = z.object({ value: z.array(z.object({ scheduleItems: z.array(z.object({ status: z.string(), start: z.object({ dateTime: z.string() }), end: z.object({ dateTime: z.string() }) })).default([]) })).default([]) }).parse(await providerJson(workspaceId, P, `${API}/calendar/getSchedule`, auth(t), { schedules: [email], startTime: { dateTime: from.toISOString().slice(0, 19), timeZone: "UTC" }, endTime: { dateTime: to.toISOString().slice(0, 19), timeZone: "UTC" }, availabilityViewInterval: 30 }));
  // "free" and "workingElsewhere" do not block a slot.
  return (r.value[0]?.scheduleItems ?? []).filter(i => ["busy", "tentative", "oof"].includes(i.status)).map(i => ({ start: utc(i.start.dateTime), end: utc(i.end.dateTime) }));
}

export function eventBody(e: EventInput) {
  return {
    subject: e.title,
    body: { contentType: "text", content: [e.agenda, e.meetingUrl ? `Join: ${e.meetingUrl}` : null].filter(Boolean).join("\n\n") },
    start: { dateTime: e.startsAt.toISOString().slice(0, 19), timeZone: "UTC" },
    end: { dateTime: e.endsAt.toISOString().slice(0, 19), timeZone: "UTC" },
    ...(e.location ?? e.meetingUrl ? { location: { displayName: e.location ?? e.meetingUrl } } : {}),
    attendees: e.attendees.map(address => ({ emailAddress: { address }, type: "required" })),
  };
}
const eventSchema = z.object({ id: z.string(), webLink: z.string().optional() });
/** `invite` is honoured by who is on the event: Graph always notifies attendees, so none are added unless asked. */
export async function createEvent(workspaceId: string, t: GoogleTokens, e: EventInput, invite: boolean) {
  return eventSchema.parse(await providerJson(workspaceId, P, `${API}/events`, auth(t), eventBody({ ...e, attendees: invite ? e.attendees : [] }) as Record<string, unknown>));
}
export async function patchEvent(workspaceId: string, t: GoogleTokens, eventId: string, patch: Partial<EventInput>) {
  const body: Record<string, unknown> = {};
  if (patch.startsAt && patch.endsAt) { body.start = { dateTime: patch.startsAt.toISOString().slice(0, 19), timeZone: "UTC" }; body.end = { dateTime: patch.endsAt.toISOString().slice(0, 19), timeZone: "UTC" }; }
  if (patch.title) body.subject = patch.title;
  return eventSchema.parse(await providerJson(workspaceId, P, `${API}/events/${encodeURIComponent(eventId)}`, auth(t), body, { method: "PATCH" }));
}
export async function deleteEvent(workspaceId: string, t: GoogleTokens, eventId: string) {
  await providerJson(workspaceId, P, `${API}/events/${encodeURIComponent(eventId)}`, auth(t), undefined, { method: "DELETE" });
}
