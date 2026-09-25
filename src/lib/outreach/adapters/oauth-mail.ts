import "server-only";
import { z } from "zod";
import { providerJson } from "@/lib/providers/http";

/**
 * Sending and reading mail through a person's own Google or Microsoft mailbox, over OAuth 2.0
 * (authorization-code flow with offline access). Endpoints, from the vendors' documentation
 * (checked 2026-09-25):
 *
 * Gmail API v1 — scopes gmail.send + gmail.readonly (Google classes both as restricted; an app
 * used outside its own Workspace needs Google's verification):
 *   send     POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send  { raw: base64url(RFC 822) }
 *   header   GET  …/users/me/messages/{id}?format=metadata&metadataHeaders=Message-ID
 *   profile  GET  …/users/me/profile → { emailAddress, historyId }
 *   history  GET  …/users/me/history?startHistoryId=&historyTypes=messageAdded&labelId=INBOX
 *            (404 when the start id is too old: restart from the current historyId)
 *   message  GET  …/users/me/messages/{id}?format=full
 *
 * Microsoft Graph v1.0 — delegated Mail.Send + Mail.Read + offline_access:
 *   draft    POST https://graph.microsoft.com/v1.0/me/messages  (Content-Type text/plain, base64 MIME)
 *            → { id, internetMessageId }
 *   send     POST …/me/messages/{id}/send → 202, empty
 *   me       GET  …/me → { mail, userPrincipalName }
 *   inbox    GET  …/me/mailFolders/inbox/messages?$filter=receivedDateTime gt …&$orderby=receivedDateTime
 *            with Prefer: outlook.body-content-type="text"
 *
 * The RFC Message-ID each provider actually used is read back after sending, because that is
 * what a recipient's reply will reference; storing the provider's internal id instead makes
 * replies unmatchable.
 */
export type MailProvider = "gmail" | "microsoft";
export type MailTokens = { accessToken: string; refreshToken: string | null; expiresAt: number; email: string | null };

export const MAIL_SCOPES: Record<MailProvider, { send: string; read: string; all: string[] }> = {
  gmail: { send: "https://www.googleapis.com/auth/gmail.send", read: "https://www.googleapis.com/auth/gmail.readonly", all: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly", "openid", "email"] },
  microsoft: { send: "Mail.Send", read: "Mail.Read", all: ["offline_access", "https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/User.Read", "openid", "email"] },
};
const P: Record<MailProvider, string> = { gmail: "gmail_mail", microsoft: "microsoft_mail" };
const client = (p: MailProvider) => (p === "gmail" ? { id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "", secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "" } : { id: process.env.MICROSOFT_OAUTH_CLIENT_ID ?? "", secret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET ?? "" });
export const mailOAuthConfigured = (p: MailProvider) => Boolean(client(p).id && client(p).secret);
const tenant = () => process.env.MICROSOFT_OAUTH_TENANT || "common";
const TOKEN_URL: Record<MailProvider, () => string> = { gmail: () => "https://oauth2.googleapis.com/token", microsoft: () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token` };

export function mailAuthUrl(p: MailProvider, redirectUri: string, state: string) {
  const u = new URL(p === "gmail" ? "https://accounts.google.com/o/oauth2/v2/auth" : `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`);
  const params: Record<string, string> = { client_id: client(p).id, redirect_uri: redirectUri, response_type: "code", scope: MAIL_SCOPES[p].all.join(" "), state };
  if (p === "gmail") Object.assign(params, { access_type: "offline", prompt: "consent", include_granted_scopes: "true" });
  else Object.assign(params, { response_mode: "query", prompt: "select_account" });
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number(), refresh_token: z.string().optional(), scope: z.string().optional(), id_token: z.string().optional() });
const emailOf = (idToken?: string) => { try { if (!idToken) return null; const c = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string; preferred_username?: string }; return c.email ?? c.preferred_username ?? null; } catch { return null; } };

export async function exchangeMailCode(workspaceId: string, p: MailProvider, code: string, redirectUri: string): Promise<MailTokens & { scopes: string[] }> {
  const t = tokenSchema.parse(await providerJson(workspaceId, P[p], TOKEN_URL[p](), {}, { code, client_id: client(p).id, client_secret: client(p).secret, redirect_uri: redirectUri, grant_type: "authorization_code" }, { form: true }));
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: Date.now() + t.expires_in * 1000, email: emailOf(t.id_token), scopes: (t.scope ?? "").split(" ").filter(Boolean) };
}
export async function refreshMail(workspaceId: string, p: MailProvider, tokens: MailTokens): Promise<MailTokens> {
  if (tokens.expiresAt - Date.now() > 60_000) return tokens;
  if (!tokens.refreshToken) throw new Error("The mailbox sign-in has expired and has no refresh token. Connect it again.");
  const t = tokenSchema.parse(await providerJson(workspaceId, P[p], TOKEN_URL[p](), {}, { refresh_token: tokens.refreshToken, client_id: client(p).id, client_secret: client(p).secret, grant_type: "refresh_token" }, { form: true }));
  // Microsoft rotates refresh tokens; keep the new one when given.
  return { ...tokens, accessToken: t.access_token, refreshToken: t.refresh_token ?? tokens.refreshToken, expiresAt: Date.now() + t.expires_in * 1000 };
}
/** Google has a revoke endpoint; Microsoft does not for a single app grant — the user removes it at myaccount.microsoft.com. */
export async function revokeMail(workspaceId: string, p: MailProvider, tokens: MailTokens): Promise<boolean> {
  if (p !== "gmail") return false;
  const token = tokens.refreshToken ?? tokens.accessToken;
  await providerJson(workspaceId, P[p], `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {}, { token }, { form: true });
  return true;
}

const bearer = (t: MailTokens) => ({ Authorization: `Bearer ${t.accessToken}` });
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH = "https://graph.microsoft.com/v1.0/me";

/** Who the mailbox is, and (Gmail) the current history id to start reading from. */
export async function mailProfile(workspaceId: string, p: MailProvider, t: MailTokens): Promise<{ address: string; cursor: string }> {
  if (p === "gmail") {
    const r = z.object({ emailAddress: z.string(), historyId: z.string() }).parse(await providerJson(workspaceId, P[p], `${GMAIL}/profile`, bearer(t)));
    return { address: r.emailAddress.toLowerCase(), cursor: r.historyId };
  }
  const r = z.object({ mail: z.string().nullish(), userPrincipalName: z.string() }).parse(await providerJson(workspaceId, P[p], `${GRAPH}?$select=mail,userPrincipalName`, bearer(t)));
  return { address: (r.mail ?? r.userPrincipalName).toLowerCase(), cursor: new Date().toISOString() };
}

/** Sends a complete RFC 822 message and returns the Message-ID the provider used. */
export async function sendMime(workspaceId: string, p: MailProvider, t: MailTokens, mime: string, fallbackId: string): Promise<string> {
  if (p === "gmail") {
    const sent = z.object({ id: z.string(), threadId: z.string().optional() }).parse(await providerJson(workspaceId, P[p], `${GMAIL}/messages/send`, bearer(t), { raw: Buffer.from(mime, "utf8").toString("base64url") }));
    // The send is done; failing to read the header back must not look like a failed send.
    try {
      const meta = z.object({ payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]) }) }).parse(await providerJson(workspaceId, P[p], `${GMAIL}/messages/${encodeURIComponent(sent.id)}?format=metadata&metadataHeaders=Message-ID`, bearer(t)));
      return meta.payload.headers.find(h => h.name.toLowerCase() === "message-id")?.value ?? fallbackId;
    } catch { return fallbackId; }
  }
  const draft = z.object({ id: z.string(), internetMessageId: z.string().nullish() }).parse(await providerJson(workspaceId, P[p], `${GRAPH}/messages`, bearer(t), undefined, { raw: { contentType: "text/plain", body: Buffer.from(mime, "utf8").toString("base64") } }));
  await providerJson(workspaceId, P[p], `${GRAPH}/messages/${encodeURIComponent(draft.id)}/send`, bearer(t), undefined, { method: "POST" });
  return draft.internetMessageId ?? fallbackId;
}

/** One inbound message as raw header text plus its plain-text body, for the shared reply matcher. */
export type FetchedMail = { key: string; headers: string; text: string };
const b64url = (v: string) => Buffer.from(v, "base64url").toString("utf8");
type GmailPart = { mimeType?: string; body?: { data?: string | null } | null; parts?: GmailPart[] | null; headers?: { name: string; value: string }[] | null };
const gmailPart: z.ZodType<GmailPart> = z.lazy(() => z.object({ mimeType: z.string().optional(), body: z.object({ data: z.string().nullish() }).passthrough().nullish(), parts: z.array(gmailPart).nullish(), headers: z.array(z.object({ name: z.string(), value: z.string() })).nullish() }).passthrough());
function textOf(part: GmailPart): string {
  if (part.mimeType === "text/plain" && part.body?.data) return b64url(part.body.data);
  for (const child of part.parts ?? []) { const t = textOf(child); if (t) return t; }
  return "";
}

/**
 * New inbox mail since the cursor. Returns the new cursor; `reset` when the provider no longer
 * has history that far back (Gmail 404), in which case reading restarts from now rather than
 * re-reading the mailbox as new mail.
 */
export async function fetchNewMail(workspaceId: string, p: MailProvider, t: MailTokens, cursor: string, max = 50): Promise<{ messages: FetchedMail[]; cursor: string; reset: boolean }> {
  if (p === "gmail") {
    let history: { history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId: string };
    try {
      history = z.object({ history: z.array(z.object({ messagesAdded: z.array(z.object({ message: z.object({ id: z.string(), labelIds: z.array(z.string()).optional() }) })).optional() })).optional(), historyId: z.string() }).parse(await providerJson(workspaceId, P[p], `${GMAIL}/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&labelId=INBOX&maxResults=${max}`, bearer(t)));
    } catch (e) {
      if ((e as { status?: number }).status === 404) { const prof = await mailProfile(workspaceId, p, t); return { messages: [], cursor: prof.cursor, reset: true }; }
      throw e;
    }
    const ids = [...new Set((history.history ?? []).flatMap(h => (h.messagesAdded ?? []).map(m => m.message.id)))].slice(0, max);
    const messages: FetchedMail[] = [];
    for (const id of ids) {
      const m = z.object({ id: z.string(), payload: gmailPart }).parse(await providerJson(workspaceId, P[p], `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`, bearer(t)));
      messages.push({ key: m.id, headers: (m.payload.headers ?? []).map(h => `${h.name}: ${h.value}`).join("\r\n"), text: textOf(m.payload) });
    }
    return { messages, cursor: history.historyId, reset: false };
  }
  const url = `${GRAPH}/mailFolders/inbox/messages?$filter=${encodeURIComponent(`receivedDateTime gt ${cursor}`)}&$orderby=receivedDateTime&$top=${max}&$select=id,internetMessageId,internetMessageHeaders,from,subject,receivedDateTime,body`;
  const r = z.object({ value: z.array(z.object({ id: z.string(), internetMessageId: z.string().nullish(), receivedDateTime: z.string(), subject: z.string().nullish(), from: z.object({ emailAddress: z.object({ address: z.string().nullish(), name: z.string().nullish() }) }).nullish(), internetMessageHeaders: z.array(z.object({ name: z.string(), value: z.string() })).nullish(), body: z.object({ content: z.string().nullish() }).nullish() })).default([]) }).parse(await providerJson(workspaceId, P[p], url, { ...bearer(t), Prefer: 'outlook.body-content-type="text"' }));
  const messages = r.value.map(m => {
    const hs = [...(m.internetMessageHeaders ?? [])];
    const has = (n: string) => hs.some(h => h.name.toLowerCase() === n);
    if (!has("message-id") && m.internetMessageId) hs.push({ name: "Message-ID", value: m.internetMessageId });
    if (!has("from") && m.from?.emailAddress.address) hs.push({ name: "From", value: m.from.emailAddress.address });
    if (!has("subject") && m.subject) hs.push({ name: "Subject", value: m.subject });
    if (!has("date")) hs.push({ name: "Date", value: new Date(m.receivedDateTime).toUTCString() });
    return { key: m.id, headers: hs.map(h => `${h.name}: ${h.value}`).join("\r\n"), text: m.body?.content ?? "" };
  });
  return { messages, cursor: r.value.at(-1)?.receivedDateTime ?? cursor, reset: false };
}
