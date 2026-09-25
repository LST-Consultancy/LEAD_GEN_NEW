import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { leadVisibilityFilter, type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { mutate, MutationError, loadScoped } from "./mutate";
import { encryptCredential, decryptCredential } from "@/lib/providers/credentials";
import { providerJson } from "@/lib/providers/http";
import { ProviderRequestError } from "@/lib/providers/provider-errors";
import { allowedKind, DEFAULT_API_VERSION, messageBody, parseWebhook, validSignature, waNumber, type OutgoingWhatsApp } from "@/lib/channels/whatsapp-cloud";
import { recordActivity, recordExternalAudit } from "./audit";
import { emitWebhookEvent } from "./webhook-events";

export const WHATSAPP_PROVIDER = "whatsapp_cloud";
type Secrets = { accessToken: string; appSecret: string };
const configSchema = z.object({ phoneNumberId: z.string().regex(/^\d{5,20}$/, "The phone number ID is the long number shown in Meta's WhatsApp Manager, not the phone number."), businessAccountId: z.string().regex(/^\d{5,20}$/), verifyToken: z.string().min(12).max(200), apiVersion: z.string().regex(/^v\d{1,2}\.\d$/).default(DEFAULT_API_VERSION), defaultCountry: z.string().regex(/^\d{1,3}$/).default("91") });
type Config = z.infer<typeof configSchema>;

async function connection(workspaceId: string) {
  const row = await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: WHATSAPP_PROVIDER } } });
  if (!row?.enabled || !row.encryptedCredentials) return null;
  const cfg = configSchema.safeParse(row.config);
  if (!cfg.success) return null;
  return { row, config: cfg.data, secrets: JSON.parse(decryptCredential(row.encryptedCredentials, workspaceId, WHATSAPP_PROVIDER)) as Secrets };
}
const graph = (c: Config, path: string) => `https://graph.facebook.com/${c.apiVersion}/${path}`;

export async function whatsappStatus(ctx: AuthContext) {
  const row = await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: WHATSAPP_PROVIDER } } });
  const cfg = configSchema.safeParse(row?.config ?? {});
  return toPlain({ connected: Boolean(row?.enabled && row.encryptedCredentials), status: row?.status ?? null, lastTestedAt: row?.lastTestedAt ?? null, phoneNumberId: cfg.success ? cfg.data.phoneNumberId : null, businessAccountId: cfg.success ? cfg.data.businessAccountId : null, apiVersion: cfg.success ? cfg.data.apiVersion : DEFAULT_API_VERSION, webhookPath: "/api/webhooks/inbound/whatsapp", display: ((row?.config ?? {}) as { display?: string }).display ?? null });
}

const connectSchema = configSchema.extend({ accessToken: z.string().min(20).max(1000).optional(), appSecret: z.string().min(16).max(200).optional() });
/** Saves the Cloud API connection and checks it with a free read of the phone number's details. */
export async function connectWhatsApp(ctx: AuthContext, raw: unknown) {
  const input = connectSchema.parse(raw ?? {});
  const existing = await connection(ctx.workspaceId).catch(() => null);
  const secrets: Secrets = { accessToken: input.accessToken ?? existing?.secrets.accessToken ?? "", appSecret: input.appSecret ?? existing?.secrets.appSecret ?? "" };
  if (!secrets.accessToken || !secrets.appSecret) throw new MutationError("Enter the system-user access token and the app secret. The app secret is what proves webhook deliveries come from Meta.", "credentials_required", 422);
  const { accessToken: _a, appSecret: _s, ...config } = input; void _a; void _s;
  let display: string | null = null; let error: string | null = null;
  try {
    const r = z.object({ display_phone_number: z.string().optional(), verified_name: z.string().optional(), quality_rating: z.string().optional() }).passthrough().parse(await providerJson(ctx.workspaceId, WHATSAPP_PROVIDER, `${graph(config, config.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, { Authorization: `Bearer ${secrets.accessToken}` }));
    display = [r.verified_name, r.display_phone_number, r.quality_rating ? `quality ${r.quality_rating}` : null].filter(Boolean).join(" · ") || null;
  } catch (e) { error = e instanceof ProviderRequestError && (e.status === 401 || e.status === 403 || e.status === 400) ? "Meta refused the token or the phone number ID. Check both in WhatsApp Manager." : "Meta could not be reached to check the number."; }
  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    const data = { enabled: true, status: error ? "ERROR" : "CONNECTED", lastTestedAt: new Date(), encryptedCredentials: encryptCredential(JSON.stringify(secrets), ctx.workspaceId, WHATSAPP_PROVIDER), config: { ...config, display } as Prisma.InputJsonValue, allowedSearch: false, allowedStorage: true, allowedEnrichment: false };
    const row = await db.providerConnection.upsert({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: WHATSAPP_PROVIDER } }, create: { workspaceId: ctx.workspaceId, provider: WHATSAPP_PROVIDER, ...data }, update: data });
    return { result: { status: row.status, note: error ? `Saved, but the check failed: ${error}` : `Connected to ${display ?? "the number"}. Point Meta's webhook at /api/webhooks/inbound/whatsapp with your verify token to receive replies and receipts.` }, log: { action: "whatsapp.connected", objectType: "ProviderConnection", objectId: row.id, after: { phoneNumberId: config.phoneNumberId, status: row.status } } };
  });
}

export async function disconnectWhatsApp(ctx: AuthContext) {
  const row = await loadScoped(() => db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: WHATSAPP_PROVIDER } } }), "The WhatsApp connection");
  return mutate(ctx, PERMISSIONS.WORKSPACE_MANAGE, async () => {
    await db.providerConnection.update({ where: { id: row.id }, data: { enabled: false, encryptedCredentials: null, status: "DISCONNECTED" } });
    return { result: { note: "Disconnected. The token and app secret are erased; nothing is sent, and webhook deliveries are refused until it is connected again." }, log: { action: "whatsapp.disconnected", objectType: "ProviderConnection", objectId: row.id } };
  });
}

async function scopedLead(ctx: AuthContext, leadId: string) {
  return loadScoped(() => db.lead.findFirst({ where: { id: leadId, workspaceId: ctx.workspaceId, deletedAt: null, ...leadVisibilityFilter(ctx) }, include: { person: { include: { contactMethods: { where: { workspaceId: ctx.workspaceId } } } } } }), "That lead");
}

const optInSchema = z.object({ number: z.string().trim().min(6).max(32), evidence: z.string().trim().min(8, "Say how and when they opted in, so it can be shown later.").max(500) });
/** Records that a person opted in to WhatsApp, with the evidence. Without this (or a message from them first), nothing is sent. */
export async function recordWhatsAppOptIn(ctx: AuthContext, leadId: string, raw: unknown) {
  const input = optInSchema.parse(raw ?? {});
  const lead = await scopedLead(ctx, leadId);
  const number = waNumber(input.number);
  if (!number) throw new MutationError("That is not a phone number WhatsApp can use. Include the country code.", "bad_number", 422);
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const existing = lead.person.contactMethods.find(c => c.kind === "WHATSAPP" && c.value === number);
    const consent = { at: new Date().toISOString(), evidence: input.evidence, recordedBy: ctx.userId };
    const row = existing
      ? await db.contactMethod.update({ where: { id: existing.id }, data: { optedOutAt: null, provenance: { ...((existing.provenance ?? {}) as object), consent: { whatsapp: consent } } as Prisma.InputJsonValue } })
      : await db.contactMethod.create({ data: { workspaceId: ctx.workspaceId, personId: lead.personId, kind: "WHATSAPP", value: number, maskedValue: `+${number.slice(0, 2)}******${number.slice(-2)}`, isLocked: false, status: "UNVERIFIED", confidence: 90, source: "manual:opt_in", verificationResult: "UNCHECKED", provenance: { consent: { whatsapp: consent } } as Prisma.InputJsonValue } });
    return { result: { contactMethodId: row.id }, log: { action: "whatsapp.opt_in_recorded", objectType: "Lead", objectId: lead.id, after: { number: row.maskedValue, evidence: input.evidence }, activity: { kind: "consent.recorded", summary: `WhatsApp opt-in recorded for ${lead.person.fullName}`, leadId: lead.id, companyId: lead.companyId, channel: "WHATSAPP" } } };
  });
}

const sendSchema = z.object({ idempotencyKey: z.string().uuid(), message: z.discriminatedUnion("kind", [z.object({ kind: z.literal("text"), body: z.string().trim().min(1).max(4096) }), z.object({ kind: z.literal("template"), name: z.string().regex(/^[a-z0-9_]{1,512}$/), language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default("en"), params: z.array(z.string().max(1024)).max(10).default([]) })]) });
/**
 * Sends one WhatsApp message to a lead through the Cloud API. Refused, before anything is written,
 * when: WhatsApp is not connected; the person has not opted in and has never messaged first; the
 * number is suppressed or opted out; or free text is sent outside 24 hours of their last message.
 */
export async function sendWhatsApp(ctx: AuthContext, leadId: string, raw: unknown) {
  const input = sendSchema.parse(raw ?? {});
  const lead = await scopedLead(ctx, leadId);
  const conn = await connection(ctx.workspaceId);
  if (!conn || conn.row.status === "ERROR") throw new MutationError("WhatsApp is not connected (Settings → WhatsApp API). Nothing was sent.", "not_connected", 422);
  const done = await db.message.findUnique({ where: { idempotencyKey: `wa-out:${ctx.workspaceId}:${input.idempotencyKey}` } });
  if (done) return toPlain({ messageId: done.id, state: done.state, note: "Already sent; not sent again." });
  const contact = lead.person.contactMethods.find(c => c.kind === "WHATSAPP" && c.value && !c.optedOutAt);
  if (!contact?.value) throw new MutationError(`No WhatsApp number with an opt-in is recorded for ${lead.person.fullName}. Record their opt-in first. Nothing was sent.`, "no_opt_in", 422);
  const conversation = await db.conversation.findFirst({ where: { workspaceId: ctx.workspaceId, leadId: lead.id, channel: "WHATSAPP", deletedAt: null }, orderBy: { lastMessageAt: "desc" } });
  const lastInbound = conversation ? await db.message.findFirst({ where: { workspaceId: ctx.workspaceId, conversationId: conversation.id, direction: "INBOUND", deletedAt: null }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }) : null;
  const consented = Boolean((contact.provenance as { consent?: { whatsapp?: unknown } } | null)?.consent?.whatsapp) || Boolean(lastInbound);
  if (!consented) throw new MutationError(`${lead.person.fullName} has not opted in to WhatsApp and has not messaged you. Meta forbids cold messages. Nothing was sent.`, "no_opt_in", 422);
  if (await db.suppression.findFirst({ where: { workspaceId: ctx.workspaceId, kind: "phone", value: { in: [contact.value, `+${contact.value}`] } } })) throw new MutationError("This number is on the do-not-contact list. Nothing was sent.", "suppressed", 422);
  if (input.message.kind === "text" && allowedKind(lastInbound?.sentAt ?? null) === "template_only") throw new MutationError("More than 24 hours have passed since their last message, so Meta only allows an approved template now. Choose a template. Nothing was sent.", "template_required", 422);
  const message = input.message as OutgoingWhatsApp;
  const conv = conversation ?? await db.conversation.create({ data: { workspaceId: ctx.workspaceId, channel: "WHATSAPP", leadId: lead.id, companyId: lead.companyId, assigneeId: ctx.userId } });
  const row = await db.message.create({ data: { workspaceId: ctx.workspaceId, conversationId: conv.id, direction: "OUTBOUND", channel: "WHATSAPP", state: "QUEUED", toAddress: contact.value, body: message.kind === "text" ? message.body : `Template ${message.name} (${message.language})${message.params.length ? `: ${message.params.join(" · ")}` : ""}`, actorType: "HUMAN", actorUserId: ctx.userId, idempotencyKey: `wa-out:${ctx.workspaceId}:${input.idempotencyKey}` } });
  let outcome: { ok: true; id: string } | { ok: false; reason: string };
  try {
    const r = z.object({ messages: z.array(z.object({ id: z.string() })).min(1) }).parse(await providerJson(ctx.workspaceId, WHATSAPP_PROVIDER, graph(conn.config, `${conn.config.phoneNumberId}/messages`), { Authorization: `Bearer ${conn.secrets.accessToken}` }, messageBody(contact.value, message)));
    outcome = { ok: true, id: r.messages[0].id };
  } catch (e) { outcome = { ok: false, reason: e instanceof ProviderRequestError && e.status ? `Meta refused the message (HTTP ${e.status}). For a template, check it is approved in this language.` : "Meta could not be reached; the message was not sent." }; }
  return mutate(ctx, PERMISSIONS.OUTREACH_SEND, async () => {
    const updated = await db.message.update({ where: { id: row.id }, data: outcome.ok ? { state: "SENT", sentAt: new Date(), externalId: outcome.id } : { state: "FAILED", failureReason: outcome.reason } });
    if (outcome.ok) { await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } }); await db.lead.update({ where: { id: lead.id }, data: { lastContactedAt: new Date(), lastActivityAt: new Date() } }); }
    return { result: toPlain({ messageId: updated.id, state: updated.state, note: outcome.ok ? "Sent through the WhatsApp Cloud API. Delivery and read receipts arrive by webhook." : `Not sent: ${outcome.reason}` }), log: { action: outcome.ok ? "whatsapp.sent" : "whatsapp.failed", objectType: "Message", objectId: row.id, after: { leadId: lead.id, kind: message.kind }, ...(outcome.ok ? { activity: { kind: "touch.outbound", summary: `WhatsApp to ${lead.person.fullName}`, leadId: lead.id, companyId: lead.companyId, channel: "WHATSAPP" as const } } : {}) } };
  });
}

/** Webhook verification handshake: the challenge is echoed only for a verify token a workspace saved. */
export async function verifyWhatsAppWebhook(mode: string | null, token: string | null, challenge: string | null) {
  if (mode !== "subscribe" || !token || !challenge || !/^[\w-]{1,200}$/.test(challenge)) return null;
  const rows = await db.providerConnection.findMany({ where: { provider: WHATSAPP_PROVIDER, enabled: true }, select: { config: true } });
  return rows.some(r => (r.config as { verifyToken?: string }).verifyToken === token) ? challenge : null;
}

/**
 * One signed webhook delivery. The body is parsed only to find which connection it is for; it is
 * acted on only when its signature verifies with that connection's app secret. Idempotent: every
 * inbound message is keyed by its WhatsApp id, so Meta's retries record nothing twice.
 */
export async function handleWhatsAppWebhook(rawBody: string, signature: string | null) {
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return { ok: false as const, status: 400 }; }
  const { messages, statuses } = parseWebhook(payload);
  const ids = [...new Set([...messages, ...statuses].map(x => x.phoneNumberId))];
  if (!ids.length) return { ok: true as const, status: 200, recorded: 0 };
  const rows = await db.providerConnection.findMany({ where: { provider: WHATSAPP_PROVIDER, enabled: true, encryptedCredentials: { not: null } } });
  const byNumber = new Map<string, { workspaceId: string; secrets: Secrets }>();
  for (const r of rows) {
    const pid = (r.config as { phoneNumberId?: string }).phoneNumberId;
    if (pid && ids.includes(pid)) byNumber.set(pid, { workspaceId: r.workspaceId, secrets: JSON.parse(decryptCredential(r.encryptedCredentials!, r.workspaceId, WHATSAPP_PROVIDER)) as Secrets });
  }
  if (!ids.every(id => byNumber.has(id) && validSignature(rawBody, signature, byNumber.get(id)!.secrets.appSecret))) return { ok: false as const, status: 401 };
  let recorded = 0;
  for (const s of statuses) {
    const { workspaceId } = byNumber.get(s.phoneNumberId)!;
    const state = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" }[s.status] as "SENT" | "DELIVERED" | "READ" | "FAILED";
    const { count } = await db.message.updateMany({ where: { workspaceId, channel: "WHATSAPP", externalId: s.id, state: { notIn: s.status === "delivered" ? ["READ", "REPLIED"] : s.status === "sent" ? ["DELIVERED", "READ", "REPLIED"] : ["REPLIED"] } }, data: { state, ...(s.status === "delivered" ? { deliveredAt: s.at } : s.status === "read" ? { readAt: s.at } : s.status === "failed" ? { failureReason: s.error ?? "Meta reported the message as failed." } : {}) } });
    recorded += count;
  }
  for (const m of messages) {
    const { workspaceId } = byNumber.get(m.phoneNumberId)!;
    const key = `wa-in:${workspaceId}:${m.id}`;
    if (await db.message.findUnique({ where: { idempotencyKey: key } })) continue;
    const contact = await db.contactMethod.findFirst({ where: { workspaceId, kind: "WHATSAPP", value: m.from }, orderBy: { createdAt: "desc" } });
    const lead = contact ? await db.lead.findFirst({ where: { workspaceId, personId: contact.personId, deletedAt: null }, orderBy: { updatedAt: "desc" } }) : null;
    const conv = (lead ? await db.conversation.findFirst({ where: { workspaceId, leadId: lead.id, channel: "WHATSAPP", deletedAt: null }, orderBy: { lastMessageAt: "desc" } }) : await db.conversation.findFirst({ where: { workspaceId, channel: "WHATSAPP", externalThreadId: m.from, deletedAt: null } }))
      ?? await db.conversation.create({ data: { workspaceId, channel: "WHATSAPP", leadId: lead?.id ?? null, companyId: lead?.companyId ?? null, externalThreadId: m.from, subject: lead ? null : `WhatsApp from +${m.from}${m.name ? ` (${m.name})` : ""}` } });
    const stopped = await db.$transaction(async tx => {
      await tx.message.create({ data: { workspaceId, conversationId: conv.id, direction: "INBOUND", channel: "WHATSAPP", state: "DELIVERED", fromAddress: m.from, body: m.text || "(empty)", externalId: m.id, idempotencyKey: key, sentAt: m.at, deliveredAt: new Date() } });
      await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: m.at, isUnread: true } });
      if (m.optOut) {
        await tx.suppression.upsert({ where: { workspaceId_kind_value: { workspaceId, kind: "phone", value: m.from } }, create: { workspaceId, kind: "phone", value: m.from, reason: `Replied "${m.text.trim().slice(0, 40)}" on WhatsApp`, source: "whatsapp" }, update: {} });
        if (contact) await tx.contactMethod.update({ where: { id: contact.id }, data: { optedOutAt: m.at } });
        if (lead) { const { count } = await tx.sequenceEnrollment.updateMany({ where: { workspaceId, leadId: lead.id, state: "active" }, data: { state: "unsubscribed", nextSendAt: null, stopReason: "Opted out on WhatsApp" } }); return count; }
        return 0;
      }
      if (!lead) return 0;
      await tx.lead.updateMany({ where: { id: lead.id, repliedAt: null }, data: { repliedAt: m.at, lastActivityAt: m.at } });
      const { count } = await tx.sequenceEnrollment.updateMany({ where: { workspaceId, leadId: lead.id, state: "active", sequence: { stopOnReply: true } }, data: { state: "replied", repliedAt: m.at, nextSendAt: null, stopReason: "Replied on WhatsApp" } });
      return count;
    });
    recorded++;
    if (m.optOut) await recordExternalAudit(workspaceId, { action: "whatsapp.opted_out", objectType: "Suppression", after: { number: `+${m.from.slice(0, 2)}******${m.from.slice(-2)}`, sequencesStopped: stopped }, claimedBy: `+${m.from}`, via: "WhatsApp webhook" });
    else if (lead) {
      await recordActivity({ workspaceId, userId: null }, { kind: "touch.inbound", summary: `WhatsApp reply${m.name ? ` from ${m.name}` : ""}`, actorType: "SYSTEM", leadId: lead.id, companyId: lead.companyId, channel: "WHATSAPP", metadata: { sequencesStopped: stopped, loggedByHand: false } });
      await emitWebhookEvent(workspaceId, "message.replied", { leadId: lead.id, channel: "WHATSAPP", occurredAt: m.at.toISOString(), loggedByHand: false, sequencesStopped: stopped });
    }
  }
  return { ok: true as const, status: 200, recorded };
}

/** What the lead page's WhatsApp card needs: whether sending is possible now, and if not, why. */
export async function whatsappForLead(ctx: AuthContext, leadId: string) {
  const lead = await scopedLead(ctx, leadId);
  const row = await db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: WHATSAPP_PROVIDER } }, select: { enabled: true, encryptedCredentials: true, status: true } });
  const contact = lead.person.contactMethods.find(c => c.kind === "WHATSAPP" && c.value);
  const conversation = await db.conversation.findFirst({ where: { workspaceId: ctx.workspaceId, leadId: lead.id, channel: "WHATSAPP", deletedAt: null }, orderBy: { lastMessageAt: "desc" }, select: { id: true } });
  const lastInbound = conversation ? await db.message.findFirst({ where: { workspaceId: ctx.workspaceId, conversationId: conversation.id, direction: "INBOUND", deletedAt: null }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }) : null;
  const suppressed = contact?.value ? Boolean(await db.suppression.findFirst({ where: { workspaceId: ctx.workspaceId, kind: "phone", value: { in: [contact.value, `+${contact.value}`] } } })) : false;
  const consent = (contact?.provenance as { consent?: { whatsapp?: { at: string; evidence: string } } } | null)?.consent?.whatsapp ?? null;
  const mobile = lead.person.contactMethods.find(c => ["MOBILE", "DIRECT_PHONE"].includes(c.kind) && c.value && !c.isLocked)?.value ?? null;
  return toPlain({
    connected: Boolean(row?.enabled && row.encryptedCredentials && row.status !== "ERROR"),
    number: contact?.maskedValue ?? null, optedOut: Boolean(contact?.optedOutAt), suppressed, consent, suggestedNumber: mobile,
    lastInboundAt: lastInbound?.sentAt ?? null, allowed: allowedKind(lastInbound?.sentAt ?? null),
    canSend: ctx.permissions.includes(PERMISSIONS.OUTREACH_SEND), canRecord: ctx.permissions.includes(PERMISSIONS.LEADS_EDIT),
  });
}
