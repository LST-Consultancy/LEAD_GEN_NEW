import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError, loadScoped } from "./mutate";
import { encryptCredential, decryptCredential } from "@/lib/providers/credentials";
import { testSmtp, type SmtpConfig } from "@/lib/outreach/adapters/smtp";
import { exchangeMailCode, mailAuthUrl, mailOAuthConfigured, mailProfile, MAIL_SCOPES, type MailProvider } from "@/lib/outreach/adapters/oauth-mail";
import { canActuallySend, isEmailConfigured } from "@/lib/outreach/provider";
import { sends } from "@/lib/outreach/mailbox-capability";
import type { SendRoute } from "@/lib/outreach/transport";
import type { EmailAddress } from "@/lib/outreach/mime";
import { signState, readState } from "./calendar";
import { mailboxTokens, view } from "./mailboxes";

/**
 * The sending side of workspace mailboxes: each workspace sends from its own mailboxes (its SMTP
 * server, or Gmail / Microsoft 365 over OAuth), chosen per sequence or as the workspace default,
 * with the server relay only as the fallback when no mailbox is set up. Credentials are
 * encrypted per workspace and never returned.
 */
const KEY = "mailbox";
const STATE_TTL_MS = 10 * 60_000;

const smtpSchema = z.object({
  label: z.string().trim().min(2).max(80),
  address: z.string().trim().toLowerCase().email(),
  fromName: z.string().trim().max(120).optional().nullable(),
  smtpHost: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+$/, "Enter the SMTP server's host name, e.g. smtp.gmail.com").max(253),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpSecurity: z.enum(["tls", "starttls"]).optional(),
  smtpUser: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(500).optional(),
});

const smtpConfigOf = (m: { smtpHost: string; smtpPort: number; smtpSecurity: string; smtpUser: string; address: string; fromName: string | null }, pass: string): SmtpConfig =>
  ({ host: m.smtpHost, port: m.smtpPort, secure: m.smtpSecurity === "tls", user: m.smtpUser, pass, from: { name: m.fromName ?? undefined, email: m.address }, timeoutMs: Number(process.env.SMTP_TIMEOUT_MS) || 20_000, requireTls: true });

/**
 * Sets up sending from a mailbox over its own SMTP server, and checks it at once: connect, TLS,
 * log in, quit. No message is sent by the check. A mailbox that only sends reads nothing.
 */
export async function connectMailboxSending(ctx: AuthContext, raw: unknown) {
  const input = smtpSchema.parse(raw ?? {});
  const existing = await db.mailbox.findUnique({ where: { workspaceId_address: { workspaceId: ctx.workspaceId, address: input.address } } });
  if (existing && existing.provider !== "imap") throw new MutationError(`${input.address} is connected through ${existing.provider === "gmail" ? "Google" : "Microsoft"} sign-in, which already sends. Disconnect it first to use SMTP instead.`, "conflict", 409);
  if (!input.password && !existing?.encryptedSmtpPassword) throw new MutationError("Enter the SMTP password or app password.", "credentials_required", 422);
  const pass = input.password ?? decryptCredential(existing!.encryptedSmtpPassword!, ctx.workspaceId, KEY);
  const smtpSecurity = input.smtpSecurity ?? (input.smtpPort === 465 ? "tls" : "starttls");
  const cfg = { smtpHost: input.smtpHost, smtpPort: input.smtpPort, smtpSecurity, smtpUser: input.smtpUser, address: input.address, fromName: input.fromName ?? null };
  const check = await testSmtp(smtpConfigOf(cfg, pass));
  const hasDefault = await db.mailbox.findFirst({ where: { workspaceId: ctx.workspaceId, isDefaultSender: true, revokedAt: null, NOT: { address: input.address } } });
  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    const data = { ...cfg, label: input.label, encryptedSmtpPassword: encryptCredential(pass, ctx.workspaceId, KEY), sendStatus: check.ok ? "CONNECTED" : "ERROR", sendLastError: check.ok ? null : check.reason, sendTestedAt: new Date(), revokedAt: null, ...(check.ok && !hasDefault ? { isDefaultSender: true } : {}) };
    const row = await db.mailbox.upsert({
      where: { workspaceId_address: { workspaceId: ctx.workspaceId, address: input.address } },
      // A new mailbox set up only for sending reads nothing until IMAP is added.
      create: { ...data, workspaceId: ctx.workspaceId, provider: "imap", status: "OFF", receiveEnabled: false, createdById: ctx.userId },
      update: data,
    });
    return {
      result: { ...toPlain(view(row)), note: check.ok ? `Ready to send as ${row.address}. The server accepted the login over TLS; no message was sent by this check.${row.isDefaultSender ? " It is the workspace's default sender." : ""}` : `Saved, but the check failed: ${check.reason}` },
      log: { action: "mailbox.sending_connected", objectType: "Mailbox", objectId: row.id, after: { address: row.address, smtpHost: row.smtpHost, sendStatus: row.sendStatus } },
    };
  });
}

/** Checks a mailbox's sending side without sending anything. */
export async function testMailboxSending(ctx: AuthContext, id: string) {
  const m = await loadScoped(() => db.mailbox.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That mailbox");
  if (m.revokedAt) throw new MutationError("This mailbox was disconnected. Connect it again.", "revoked", 409);
  let error: string | null = null;
  if (m.provider === "imap") {
    if (!m.smtpHost || !m.encryptedSmtpPassword || !m.smtpPort || !m.smtpUser) throw new MutationError("This mailbox has no sending set up. Add its SMTP details to send from it.", "not_sending", 409);
    const r = await testSmtp(smtpConfigOf({ smtpHost: m.smtpHost, smtpPort: m.smtpPort, smtpSecurity: m.smtpSecurity ?? "starttls", smtpUser: m.smtpUser, address: m.address, fromName: m.fromName }, decryptCredential(m.encryptedSmtpPassword, ctx.workspaceId, KEY)));
    if (!r.ok) error = r.reason;
  } else {
    // A token refresh and a profile read: free, and proves the grant still works. Nothing is sent.
    try { await mailProfile(ctx.workspaceId, m.provider as MailProvider, await mailboxTokens(ctx.workspaceId, m)); }
    catch (e) { error = e instanceof Error && e.message.length < 200 ? e.message : "The provider refused the saved sign-in. Connect the mailbox again."; }
  }
  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    const oauth = m.provider !== "imap";
    // An OAuth mailbox granted no send scope stays unable to send, whatever the check says.
    const sendStatus = oauth && m.sendStatus === "NONE" ? "NONE" : error ? "ERROR" : "CONNECTED";
    const row = await db.mailbox.update({ where: { id: m.id }, data: { sendStatus, sendLastError: error, sendTestedAt: new Date(), ...(oauth ? { status: error ? "ERROR" : m.receiveEnabled ? "CONNECTED" : m.status, lastError: error, lastTestedAt: new Date() } : {}) } });
    return { result: { ...toPlain(view(row)), note: error ? `The check failed: ${error}` : "The mailbox accepted the sign-in. No message was sent." }, log: { action: "mailbox.tested", objectType: "Mailbox", objectId: m.id, after: { ok: !error, side: "send" } } };
  });
}

/** The mailbox the workspace sends from when a sequence or message names none. */
export async function setDefaultSender(ctx: AuthContext, id: string) {
  const m = await loadScoped(() => db.mailbox.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That mailbox");
  if (!sends(m)) throw new MutationError("Only a mailbox that can send can be the default sender. Test its sending first.", "not_sending", 422);
  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    await db.$transaction([
      db.mailbox.updateMany({ where: { workspaceId: ctx.workspaceId, isDefaultSender: true }, data: { isDefaultSender: false } }),
      db.mailbox.update({ where: { id: m.id }, data: { isDefaultSender: true } }),
    ]);
    return { result: { note: `New messages send from ${m.address} unless a sequence names another mailbox.` }, log: { action: "mailbox.default_sender_set", objectType: "Mailbox", objectId: m.id, after: { address: m.address } } };
  });
}

/** Which mailbox a sequence sends from; null uses the workspace default. */
export async function setSequenceSender(ctx: AuthContext, sequenceId: string, raw: unknown) {
  const { mailboxId } = z.object({ mailboxId: z.string().uuid().nullable() }).parse(raw ?? {});
  const sequence = await loadScoped(() => db.sequence.findFirst({ where: { id: sequenceId, workspaceId: ctx.workspaceId, deletedAt: null } }), "That sequence");
  const box = mailboxId ? await loadScoped(() => db.mailbox.findFirst({ where: { id: mailboxId, workspaceId: ctx.workspaceId } }), "That mailbox") : null;
  if (box && !sends(box)) throw new MutationError(`${box.address} cannot send right now. Test its sending in Settings → Email Accounts first.`, "not_sending", 422);
  return mutate(ctx, PERMISSIONS.OUTREACH_SEND, async () => {
    await db.sequence.update({ where: { id: sequence.id }, data: { senderMailboxId: box?.id ?? null } });
    return { result: { senderMailboxId: box?.id ?? null, note: box ? `"${sequence.name}" now sends from ${box.address}. Messages already queued keep their sender.` : `"${sequence.name}" now sends from the workspace default.` }, log: { action: "sequence.sender_set", objectType: "Sequence", objectId: sequence.id, before: { senderMailboxId: sequence.senderMailboxId }, after: { senderMailboxId: box?.id ?? null } } };
  });
}

/** Mailboxes a person may pick as a sender. */
export async function listSenders(ctx: AuthContext) {
  const rows = await db.mailbox.findMany({ where: { workspaceId: ctx.workspaceId, revokedAt: null, sendStatus: "CONNECTED" }, orderBy: [{ isDefaultSender: "desc" }, { createdAt: "asc" }], select: { id: true, address: true, label: true, isDefaultSender: true, provider: true } });
  return { mailboxes: rows, relay: canActuallySend() ? (process.env.EMAIL_FROM ?? null) : null };
}

/** Whether this workspace can send email at all: a sending mailbox, or the server relay. */
export async function sendingReady(workspaceId: string) {
  if (isEmailConfigured()) return true;
  return Boolean(await db.mailbox.findFirst({ where: { workspaceId, revokedAt: null, sendStatus: "CONNECTED" }, select: { id: true } }));
}

export type ResolvedSender = { ok: true; route: SendRoute; from: EmailAddress; mailboxId: string | null } | { ok: false; reason: string; retryable: boolean };

/**
 * The route one message is sent by. A mailbox named for the message or its sequence is used or
 * nothing is: when it stops working the message is held with the reason, never quietly sent from
 * someone else's address. With none named: the workspace default sender, then the server relay.
 */
export async function senderFor(workspaceId: string, named: string | null): Promise<ResolvedSender> {
  const m = named
    ? await db.mailbox.findFirst({ where: { id: named, workspaceId } })
    : await db.mailbox.findFirst({ where: { workspaceId, isDefaultSender: true, revokedAt: null, sendStatus: "CONNECTED" } });
  if (named && (!m || !sends(m))) return { ok: false, reason: `The mailbox chosen to send this (${m?.address ?? "removed"}) cannot send now${m?.sendLastError ? `: ${m.sendLastError}` : ""}. Nothing was sent; fix or change the sender in Settings → Email Accounts.`, retryable: true };
  if (m) {
    const from = { name: m.fromName ?? undefined, email: m.address };
    if (m.provider === "imap") {
      if (!m.smtpHost || !m.smtpPort || !m.smtpUser || !m.encryptedSmtpPassword) return { ok: false, reason: `${m.address} has no SMTP details saved. Nothing was sent.`, retryable: true };
      return { ok: true, mailboxId: m.id, from, route: { kind: "smtp", config: smtpConfigOf({ smtpHost: m.smtpHost, smtpPort: m.smtpPort, smtpSecurity: m.smtpSecurity ?? "starttls", smtpUser: m.smtpUser, address: m.address, fromName: m.fromName }, decryptCredential(m.encryptedSmtpPassword, workspaceId, KEY)) } };
    }
    try { return { ok: true, mailboxId: m.id, from, route: { kind: "oauth", provider: m.provider as MailProvider, workspaceId, tokens: await mailboxTokens(workspaceId, m) } }; }
    catch (e) {
      await db.mailbox.update({ where: { id: m.id }, data: { sendStatus: "ERROR", sendLastError: e instanceof Error ? e.message : "Sign-in refresh failed." } });
      return { ok: false, reason: `${m.address}'s sign-in could not be refreshed. Nothing was sent; reconnect it in Settings → Email Accounts.`, retryable: true };
    }
  }
  // A relay credential routes to the relay even without an adapter, so the send fails with that
  // specific reason ("no adapter for …") rather than a vaguer hold.
  if (isEmailConfigured()) return { ok: true, mailboxId: null, from: { name: process.env.EMAIL_FROM_NAME || undefined, email: process.env.EMAIL_FROM ?? "" }, route: { kind: "relay" } };
  return { ok: false, reason: "No mailbox is set up to send from, and the server has no relay. Nothing was sent.", retryable: true };
}

// ── Gmail / Microsoft 365 over OAuth ──────────────────────────────────────────────────────────────

export const mailRedirectUri = (provider: MailProvider, requestUrl: string) => `${process.env.APP_URL?.replace(/\/+$/, "") || new URL(requestUrl).origin}/api/mailboxes/oauth/${provider}/callback`;

export function startMailConnect(ctx: AuthContext, provider: MailProvider, redirectUri: string) {
  if (!ctx.permissions.includes(PERMISSIONS.WORKSPACE_MANAGE)) throw new MutationError("Only workspace managers can connect mailboxes.", "forbidden", 403);
  if (!mailOAuthConfigured(provider)) throw new MutationError(provider === "gmail" ? "Google sign-in for mailboxes is not set up on this server: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are needed, with the Gmail API enabled and this app's mail callback URL registered." : "Microsoft sign-in for mailboxes is not set up on this server: MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET are needed, from an Entra ID app registration with Mail.Send and Mail.Read.", "not_configured", 422);
  const nonce = randomBytes(18).toString("base64url");
  return { url: mailAuthUrl(provider, redirectUri, signState({ workspaceId: ctx.workspaceId, userId: ctx.userId, nonce, exp: Date.now() + STATE_TTL_MS })), nonce };
}

const granted = (scopes: string[], want: string) => scopes.some(s => s === want || s.endsWith(`/${want}`) || want.endsWith(`/${s}`));

/** Finishes the sign-in: saves the mailbox with what was actually granted, and starts reading from now. */
export async function completeMailConnect(ctx: AuthContext, provider: MailProvider, raw: { code?: string | null; state?: string | null; error?: string | null; cookieNonce?: string | null; redirectUri: string }) {
  const who = provider === "gmail" ? "Google" : "Microsoft";
  if (raw.error) throw new MutationError(raw.error === "access_denied" ? "Mailbox access was not granted, so nothing was connected." : `${who} returned an error (${raw.error}). Nothing was connected.`, "oauth_denied", 400);
  const state = raw.state ? readState(raw.state) : null;
  if (!state || !raw.code || !raw.cookieNonce || state.nonce !== raw.cookieNonce || state.userId !== ctx.userId || state.workspaceId !== ctx.workspaceId) throw new MutationError("This sign-in link is expired or was not started from this browser. Start again from Settings → Email Accounts.", "oauth_state", 400);
  const tokens = await exchangeMailCode(ctx.workspaceId, provider, raw.code, raw.redirectUri);
  const canSend = granted(tokens.scopes, MAIL_SCOPES[provider].send), canRead = granted(tokens.scopes, MAIL_SCOPES[provider].read);
  if (!canSend && !canRead) throw new MutationError(`${who} granted neither sending nor reading. Tick the mail permissions on the consent screen. Nothing was connected.`, "scopes_missing", 422);
  const profile = await mailProfile(ctx.workspaceId, provider, tokens);
  const existing = await db.mailbox.findUnique({ where: { workspaceId_address: { workspaceId: ctx.workspaceId, address: profile.address } } });
  const hasDefault = await db.mailbox.findFirst({ where: { workspaceId: ctx.workspaceId, isDefaultSender: true, revokedAt: null, NOT: { address: profile.address } } });
  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    const data = {
      provider, label: existing?.label ?? `${who} — ${profile.address}`, encryptedTokens: encryptCredential(JSON.stringify({ ...tokens, email: profile.address }), ctx.workspaceId, KEY), scopes: tokens.scopes,
      status: canRead ? "CONNECTED" : "OFF", receiveEnabled: canRead, readCursor: profile.cursor, lastError: null, lastTestedAt: new Date(),
      sendStatus: canSend ? "CONNECTED" : "NONE", sendLastError: null, sendTestedAt: new Date(), revokedAt: null,
      imapHost: null, imapUser: null, encryptedPassword: null, smtpHost: null, smtpPort: null, smtpUser: null, smtpSecurity: null, encryptedSmtpPassword: null,
      ...(canSend && !hasDefault ? { isDefaultSender: true } : {}),
    };
    const row = await db.mailbox.upsert({ where: { workspaceId_address: { workspaceId: ctx.workspaceId, address: profile.address } }, create: { ...data, workspaceId: ctx.workspaceId, address: profile.address, createdById: ctx.userId }, update: data });
    return {
      result: { address: row.address, canSend, canRead, note: `Connected ${row.address} through ${who}: ${canSend && canRead ? "it sends and its replies are read" : canSend ? "it sends; reading was not granted, so replies are not read" : "its replies are read; sending was not granted"}. Mail that arrived before now is not read as replies.` },
      log: { action: "mailbox.oauth_connected", objectType: "Mailbox", objectId: row.id, after: { provider, address: row.address, canSend, canRead } },
    };
  });
}
