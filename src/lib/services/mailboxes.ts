import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError, loadScoped } from "./mutate";
import { encryptCredential, decryptCredential } from "@/lib/providers/credentials";
import { checkMailbox, fetchSince, ImapError, type ImapConfig } from "@/lib/outreach/imap";
import { addressOf, classifyInbound, messageIds, parseHeaders, replyText } from "@/lib/outreach/inbound";
import { canReceiveReplies } from "@/lib/outreach/provider";
import { capabilityOf } from "@/lib/outreach/mailbox-capability";
import { fetchNewMail, refreshMail, type MailProvider, type MailTokens } from "@/lib/outreach/adapters/oauth-mail";
import { recordActivity } from "./audit";
import { emitWebhookEvent } from "./webhook-events";

const PROVIDER_KEY = "mailbox";
type MailboxRow = NonNullable<Awaited<ReturnType<typeof db.mailbox.findFirst>>>;
/** What a screen may see of a mailbox: never a password or token, only whether one is held. */
export const view = (m: MailboxRow) => ({
  id: m.id, label: m.label, address: m.address, provider: m.provider, imapHost: m.imapHost, imapPort: m.imapPort, imapSecure: m.imapSecure, imapUser: m.imapUser, folder: m.folder,
  status: m.status, receiveEnabled: m.receiveEnabled, lastError: m.lastError, lastTestedAt: m.lastTestedAt, lastSyncedAt: m.lastSyncedAt, repliesMatched: m.repliesMatched, revokedAt: m.revokedAt, hasPassword: Boolean(m.encryptedPassword),
  smtpHost: m.smtpHost, smtpPort: m.smtpPort, smtpSecurity: m.smtpSecurity, smtpUser: m.smtpUser, hasSmtpPassword: Boolean(m.encryptedSmtpPassword), sendStatus: m.sendStatus, sendLastError: m.sendLastError, sendTestedAt: m.sendTestedAt,
  fromName: m.fromName, isDefaultSender: m.isDefaultSender, hasTokens: Boolean(m.encryptedTokens), capability: capabilityOf(m),
});

/** Whether this workspace's replies are read automatically: a connected mailbox, or a provider-level reader. */
export async function readsReplies(workspaceId: string) {
  if (canReceiveReplies()) return true;
  return Boolean(await db.mailbox.findFirst({ where: { workspaceId, status: "CONNECTED", receiveEnabled: true, revokedAt: null } }));
}

export async function listMailboxes(ctx: AuthContext) {
  const rows = await db.mailbox.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "asc" } });
  return toPlain(rows.map(view));
}

const connectSchema = z.object({
  label: z.string().trim().min(2).max(80),
  address: z.string().trim().toLowerCase().email(),
  imapHost: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+$/, "Enter the IMAP server's host name, e.g. imap.gmail.com").max(253),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
  imapUser: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(500).optional(),
  folder: z.string().trim().min(1).max(200).default("INBOX"),
});

/**
 * Saves a mailbox and checks it at once: log in and open the folder, read-only. Reading starts
 * from the newest message now, so mail that arrived before connecting is not treated as replies.
 */
export async function connectMailbox(ctx: AuthContext, raw: unknown) {
  const input = connectSchema.parse(raw ?? {});
  const existing = await db.mailbox.findUnique({ where: { workspaceId_address: { workspaceId: ctx.workspaceId, address: input.address } } });
  if (!input.password && !existing?.encryptedPassword) throw new MutationError("Enter the mailbox password or app password.", "credentials_required", 422);
  const pass = input.password ?? decryptCredential(existing!.encryptedPassword!, ctx.workspaceId, PROVIDER_KEY);
  const config: ImapConfig = { host: input.imapHost, port: input.imapPort, secure: input.imapSecure, user: input.imapUser, pass, folder: input.folder };
  let check: Awaited<ReturnType<typeof checkMailbox>> | null = null; let error: string | null = null;
  try { check = await checkMailbox(config); } catch (e) { error = e instanceof ImapError ? (e.kind === "auth" ? "The server refused the login. Check the user name and password; Gmail and Microsoft 365 need an app password when two-step sign-in is on." : e.message) : "The mailbox could not be checked."; }
  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    const data = { label: input.label, imapHost: input.imapHost, imapPort: input.imapPort, imapSecure: input.imapSecure, imapUser: input.imapUser, folder: input.folder, encryptedPassword: encryptCredential(pass, ctx.workspaceId, PROVIDER_KEY), status: check ? "CONNECTED" : "ERROR", receiveEnabled: true, lastError: error, lastTestedAt: new Date(), revokedAt: null,
      ...(check ? { uidValidity: check.uidValidity, lastUid: Math.max(0, (check.uidNext ?? 1) - 1) } : {}) };
    const row = await db.mailbox.upsert({ where: { workspaceId_address: { workspaceId: ctx.workspaceId, address: input.address } }, create: { ...data, workspaceId: ctx.workspaceId, address: input.address, createdById: ctx.userId }, update: data });
    return { result: { ...toPlain(view(row)), note: check ? `Connected. ${check.exists} messages in ${input.folder}; replies arriving from now on are read every five minutes. Nothing in the mailbox is changed.` : `Saved, but the check failed: ${error}` }, log: { action: "mailbox.connected", objectType: "Mailbox", objectId: row.id, after: { address: row.address, status: row.status } } };
  });
}

export async function testMailbox(ctx: AuthContext, id: string) {
  const m = await loadScoped(() => db.mailbox.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That mailbox");
  // Sending is checked by its own test; this one checks reading.
  if (m.provider !== "imap" || !m.imapHost) { const { testMailboxSending } = await import("./mailbox-sending"); return testMailboxSending(ctx, id); }
  if (m.revokedAt || !m.encryptedPassword) throw new MutationError("This mailbox was disconnected. Connect it again with its password.", "revoked", 409);
  let error: string | null = null;
  try { await checkMailbox({ host: m.imapHost, port: m.imapPort, secure: m.imapSecure, user: m.imapUser ?? m.address, pass: decryptCredential(m.encryptedPassword, ctx.workspaceId, PROVIDER_KEY), folder: m.folder }); }
  catch (e) { error = e instanceof ImapError ? e.message : "The mailbox could not be checked."; }
  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    const row = await db.mailbox.update({ where: { id: m.id }, data: { status: error ? "ERROR" : "CONNECTED", lastError: error, lastTestedAt: new Date() } });
    return { result: { ...toPlain(view(row)), note: error ? `The check failed: ${error}` : "The mailbox answered and the folder opened. Nothing was changed." }, log: { action: "mailbox.tested", objectType: "Mailbox", objectId: m.id, after: { ok: !error } } };
  });
}

/** Stops reading and erases the saved password. Replies already recorded stay. */
export async function revokeMailbox(ctx: AuthContext, id: string) {
  const m = await loadScoped(() => db.mailbox.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That mailbox");
  // An OAuth grant is revoked at the provider where it has an endpoint for it; either way every secret here is erased.
  let told: boolean | null = null;
  if (m.encryptedTokens && (m.provider === "gmail" || m.provider === "microsoft")) {
    const { revokeMail } = await import("@/lib/outreach/adapters/oauth-mail");
    told = await revokeMail(ctx.workspaceId, m.provider, JSON.parse(decryptCredential(m.encryptedTokens, ctx.workspaceId, PROVIDER_KEY))).catch(() => false);
  }
  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    const row = await db.mailbox.update({ where: { id: m.id }, data: { encryptedPassword: null, encryptedSmtpPassword: null, encryptedTokens: null, status: "REVOKED", sendStatus: m.sendStatus === "NONE" ? "NONE" : "REVOKED", isDefaultSender: false, revokedAt: new Date() } });
    // Sequences that sent from it fall back to the workspace default; messages already queued from it are held, not re-routed.
    await db.sequence.updateMany({ where: { workspaceId: ctx.workspaceId, senderMailboxId: m.id }, data: { senderMailboxId: null } });
    const stillReads = await readsReplies(ctx.workspaceId);
    const oauth = m.provider === "gmail" ? (told ? " Google was told to revoke access." : " Google could not be reached to revoke access — remove it at myaccount.google.com/permissions.") : m.provider === "microsoft" ? " Remove the app's access at myaccount.microsoft.com → Apps if you no longer want it granted." : "";
    return { result: { ...toPlain(view(row)), note: `Disconnected; its passwords and tokens are erased.${oauth}${stillReads ? "" : " No mailbox is read now, so sequences that stop on reply cannot be activated or enrolled into until one is connected."}` }, log: { action: "mailbox.revoked", objectType: "Mailbox", objectId: m.id, before: { status: m.status, sendStatus: m.sendStatus } } };
  });
}

export type SyncResult = { read: number; replies: number; autoReplies: number; bounces: number; unmatched: number; sequencesStopped: number; reset: boolean; error: string | null };

/**
 * Reads new mail and records the messages that answer something this workspace sent. Idempotent:
 * each inbound message is keyed by its Message-ID, the stop-on-reply update only touches active
 * enrollments, and the UID cursor moves only after the batch is recorded — a redelivered job
 * re-reads the same UIDs and changes nothing the second time.
 */
export async function syncMailbox(workspaceId: string, mailboxId: string): Promise<SyncResult> {
  const out: SyncResult = { read: 0, replies: 0, autoReplies: 0, bounces: 0, unmatched: 0, sequencesStopped: 0, reset: false, error: null };
  const m = await db.mailbox.findFirst({ where: { id: mailboxId, workspaceId, revokedAt: null, receiveEnabled: true, status: { in: ["CONNECTED", "ERROR"] } } });
  if (!m) return { ...out, error: "Not connected." };
  if (m.provider === "gmail" || m.provider === "microsoft") return syncOAuthMailbox(workspaceId, m, out);
  if (!m.encryptedPassword || !m.imapHost) return { ...out, error: "Not connected." };
  const config: ImapConfig = { host: m.imapHost, port: m.imapPort, secure: m.imapSecure, user: m.imapUser ?? m.address, pass: decryptCredential(m.encryptedPassword, workspaceId, PROVIDER_KEY), folder: m.folder };
  let batch: Awaited<ReturnType<typeof fetchSince>>;
  try { batch = await fetchSince(config, m.lastUid); }
  catch (e) {
    const error = e instanceof ImapError ? e.message : "The mailbox could not be read.";
    await db.mailbox.update({ where: { id: m.id }, data: { status: "ERROR", lastError: error, lastSyncedAt: new Date() } });
    return { ...out, error };
  }
  // A new UIDVALIDITY means every UID was renumbered; start again from the newest rather than re-read the folder as new.
  if (m.uidValidity && batch.uidValidity && batch.uidValidity !== m.uidValidity) {
    const check = await checkMailbox(config).catch(() => null);
    await db.mailbox.update({ where: { id: m.id }, data: { uidValidity: batch.uidValidity, lastUid: Math.max(0, (check?.uidNext ?? 1) - 1), lastSyncedAt: new Date(), lastError: "The server renumbered this folder; reading restarted from the newest message." } });
    return { ...out, reset: true };
  }
  for (const msg of batch.messages) await recordInbound(workspaceId, m, { headers: msg.headers, text: msg.text, fallbackKey: `uid-${m.id}-${msg.uid}` }, out);
  await db.mailbox.update({ where: { id: m.id }, data: { lastUid: batch.highestUid, uidValidity: batch.uidValidity ?? m.uidValidity, lastSyncedAt: new Date(), status: "CONNECTED", lastError: null, repliesMatched: { increment: out.replies } } });
  return out;
}

/** Live OAuth tokens for a mailbox, refreshed and saved when near expiry. */
export async function mailboxTokens(workspaceId: string, m: MailboxRow): Promise<MailTokens> {
  if (!m.encryptedTokens) throw new Error("This mailbox has no sign-in saved. Connect it again.");
  const current = JSON.parse(decryptCredential(m.encryptedTokens, workspaceId, PROVIDER_KEY)) as MailTokens;
  const fresh = await refreshMail(workspaceId, m.provider as MailProvider, current);
  if (fresh.accessToken !== current.accessToken) await db.mailbox.update({ where: { id: m.id }, data: { encryptedTokens: encryptCredential(JSON.stringify(fresh), workspaceId, PROVIDER_KEY) } });
  return fresh;
}

async function syncOAuthMailbox(workspaceId: string, m: MailboxRow, out: SyncResult): Promise<SyncResult> {
  let batch: Awaited<ReturnType<typeof fetchNewMail>>;
  try { batch = await fetchNewMail(workspaceId, m.provider as MailProvider, await mailboxTokens(workspaceId, m), m.readCursor ?? new Date().toISOString()); }
  catch (e) {
    const error = e instanceof Error && e.message.length < 200 ? e.message : "The mailbox could not be read.";
    await db.mailbox.update({ where: { id: m.id }, data: { status: "ERROR", lastError: error, lastSyncedAt: new Date() } });
    return { ...out, error };
  }
  if (batch.reset) {
    await db.mailbox.update({ where: { id: m.id }, data: { readCursor: batch.cursor, lastSyncedAt: new Date(), lastError: "The provider no longer had history that far back; reading restarted from now." } });
    return { ...out, reset: true };
  }
  for (const msg of batch.messages) await recordInbound(workspaceId, m, { headers: msg.headers, text: msg.text, fallbackKey: `${m.provider}-${m.id}-${msg.key}` }, out);
  await db.mailbox.update({ where: { id: m.id }, data: { readCursor: batch.cursor, lastSyncedAt: new Date(), status: "CONNECTED", lastError: null, repliesMatched: { increment: out.replies } } });
  return out;
}

/**
 * One inbound message, from any reader. Recorded only when it answers something this workspace
 * sent; keyed by its Message-ID so reading it twice changes nothing.
 */
async function recordInbound(workspaceId: string, m: MailboxRow, msg: { headers: string; text: string; fallbackKey: string }, out: SyncResult) {
  out.read++;
  const h = parseHeaders(msg.headers);
  const refs = [...messageIds(h["in-reply-to"]), ...messageIds(h.references)];
  const own = messageIds(h["message-id"])[0] ?? `<${msg.fallbackKey}>`;
  const original = refs.length ? await db.message.findFirst({ where: { workspaceId, direction: "OUTBOUND", externalId: { in: refs }, deletedAt: null }, include: { conversation: { select: { id: true, leadId: true, companyId: true } } }, orderBy: { sentAt: "desc" } }) : null;
  if (!original) { out.unmatched++; return; }
  const kind = classifyInbound(h);
  const key = `inbound:${workspaceId}:${own}`;
  if (await db.message.findUnique({ where: { idempotencyKey: key } })) return;
  const at = h.date && Number.isFinite(Date.parse(h.date)) ? new Date(Math.min(Date.parse(h.date), Date.now())) : new Date();
  const stopped = await db.$transaction(async tx => {
    await tx.message.create({ data: { workspaceId, conversationId: original.conversationId, mailboxId: m.id, direction: "INBOUND", channel: "EMAIL", state: kind === "bounce" ? "BOUNCED" : "DELIVERED", fromAddress: addressOf(h.from), toAddress: m.address, subject: h.subject ?? null, body: replyText(msg.text, h["content-type"]) || "(no readable text)", actorType: "HUMAN", externalId: own, idempotencyKey: key, sentAt: at, deliveredAt: new Date() } });
    await tx.conversation.update({ where: { id: original.conversationId }, data: { lastMessageAt: at, isUnread: true } });
    if (kind === "bounce") { await tx.message.update({ where: { id: original.id }, data: { state: "BOUNCED", bouncedAt: at } }); return 0; }
    if (kind === "auto_reply" || !original.conversation.leadId) return 0;
    await tx.message.update({ where: { id: original.id }, data: { state: "REPLIED" } });
    await tx.lead.updateMany({ where: { id: original.conversation.leadId, workspaceId, repliedAt: null }, data: { repliedAt: at, lastActivityAt: at } });
    const { count } = await tx.sequenceEnrollment.updateMany({ where: { workspaceId, leadId: original.conversation.leadId, state: "active", sequence: { stopOnReply: true } }, data: { state: "replied", repliedAt: at, nextSendAt: null, stopReason: `Reply read from ${m.address}` } });
    return count;
  });
  if (kind === "bounce") { out.bounces++; return; }
  if (kind === "auto_reply") { out.autoReplies++; return; }
  out.replies++; out.sequencesStopped += stopped;
  if (original.conversation.leadId) {
    await recordActivity({ workspaceId, userId: null }, { kind: "touch.inbound", summary: `Email reply from ${addressOf(h.from) ?? "the lead"}`, actorType: "SYSTEM", leadId: original.conversation.leadId, companyId: original.conversation.companyId ?? undefined, channel: "EMAIL", metadata: { mailbox: m.address, sequencesStopped: stopped, loggedByHand: false } });
    await emitWebhookEvent(workspaceId, "message.replied", { leadId: original.conversation.leadId, channel: "EMAIL", occurredAt: at.toISOString(), loggedByHand: false, sequencesStopped: stopped });
  }
}

/** The scheduled job: every connected mailbox in the workspace. One failing mailbox does not stop the others. */
export async function syncWorkspaceMailboxes(workspaceId: string) {
  const boxes = await db.mailbox.findMany({ where: { workspaceId, revokedAt: null, receiveEnabled: true, status: { in: ["CONNECTED", "ERROR"] } }, select: { id: true } });
  const results: Record<string, SyncResult> = {};
  for (const b of boxes) results[b.id] = await syncMailbox(workspaceId, b.id);
  return results;
}

/** A person reads the mailbox now instead of waiting for the next five-minute run. */
export async function syncMailboxNow(ctx: AuthContext, id: string) {
  const m = await loadScoped(() => db.mailbox.findFirst({ where: { id, workspaceId: ctx.workspaceId } }), "That mailbox");
  if (m.revokedAt) throw new MutationError("This mailbox was disconnected.", "revoked", 409);
  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    const r = await syncMailbox(ctx.workspaceId, m.id);
    return { result: { ...r, note: r.error ? `Could not read it: ${r.error}` : r.reset ? "The server renumbered the folder; reading restarted from the newest message." : `Read ${r.read} new ${r.read === 1 ? "message" : "messages"}: ${r.replies} ${r.replies === 1 ? "reply" : "replies"}${r.sequencesStopped ? ` (${r.sequencesStopped} ${r.sequencesStopped === 1 ? "sequence" : "sequences"} stopped)` : ""}, ${r.autoReplies} automatic, ${r.bounces} bounced, ${r.unmatched} not answering anything sent from here.` }, log: { action: "mailbox.synced", objectType: "Mailbox", objectId: m.id, after: r } };
  });
}
