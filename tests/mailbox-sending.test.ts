/**
 * Workspace mailboxes as senders: per-workspace SMTP and Gmail / Microsoft 365 over OAuth, sender
 * choice, the send claim, threading, and reading replies through the OAuth APIs. The SMTP adapter
 * and the provider HTTP layer are replaced by fakes, so nothing leaves the process; the SMTP
 * protocol itself is covered against a real socket in smtp.test.ts.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/outreach/adapters/smtp", async original => ({ ...(await original<typeof import("@/lib/outreach/adapters/smtp")>()), testSmtp: vi.fn(), sendViaSmtp: vi.fn() }));
vi.mock("@/lib/providers/http", async original => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
import { testSmtp, sendViaSmtp } from "@/lib/outreach/adapters/smtp";
import { providerJson } from "@/lib/providers/http";
import { makeWorkspace, makeLead, cleanup, db } from "./helpers/fixtures";
import { completeMailConnect, connectMailboxSending, senderFor, sendingReady, setDefaultSender, setSequenceSender, startMailConnect } from "@/lib/services/mailbox-sending";
import { listMailboxes, readsReplies, revokeMailbox, syncMailbox } from "@/lib/services/mailboxes";
import { sendMessage, advanceSequences } from "@/lib/queue/handlers/outreach";
import { threadHeaders } from "@/lib/outreach/mime";
import { capabilityOf } from "@/lib/outreach/mailbox-capability";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
/** No server relay: every send here must come from a workspace mailbox, or not at all. */
function withoutRelay() {
  for (const k of ["EMAIL_PROVIDER", "SMTP_URL", "RESEND_API_KEY", "AWS_SES_ACCESS_KEY_ID", "POSTMARK_SERVER_TOKEN", "GOOGLE_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_ID", "EMAIL_FROM"]) vi.stubEnv(k, "");
  vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "cd".repeat(32));
  vi.stubEnv("AUTH_SECRET", "x".repeat(40));
}
beforeEach(() => { withoutRelay(); vi.mocked(testSmtp).mockReset().mockResolvedValue({ ok: true, providerMessageId: "", adapter: "smtp" }); vi.mocked(sendViaSmtp).mockReset(); vi.mocked(providerJson).mockReset(); });
afterEach(() => vi.unstubAllEnvs());

async function ws(name = "MailSend") { const w = await makeWorkspace(name); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id); return w; }
const SMTP = { label: "Sales", address: "priya@northbridge-synthetic.example", fromName: "Priya at Northbridge", smtpHost: "smtp.northbridge-synthetic.example", smtpPort: 587, smtpUser: "priya@northbridge-synthetic.example", password: "app-password-1" };
async function queued(workspaceId: string, userId: string, over: { mailboxId?: string | null } = {}) {
  const { lead, company } = await makeLead(workspaceId, { ownerId: userId });
  const conversation = await db.conversation.create({ data: { workspaceId, channel: "EMAIL", leadId: lead.id, companyId: company.id } });
  const message = await db.message.create({ data: { workspaceId, conversationId: conversation.id, direction: "OUTBOUND", channel: "EMAIL", state: "QUEUED", toAddress: "meera@buyer-synthetic.example", subject: "Following up", body: "Hi Meera", mailboxId: over.mailboxId ?? null } });
  return { lead, conversation, message };
}

describe("pure parts", () => {
  it("threads a reply to the latest message and keeps the chain within the line limit", () => {
    expect(threadHeaders([])).toEqual({});
    expect(threadHeaders(["<a@x.example>", "not-an-id", "<b@y.example>"])).toEqual({ "In-Reply-To": "<b@y.example>", References: "<a@x.example> <b@y.example>" });
    const long = Array.from({ length: 30 }, (_, i) => `<m${i}-${"x".repeat(60)}@x.example>`);
    const h = threadHeaders(long);
    expect(h["In-Reply-To"]).toBe(long[29]);
    expect(h.References.startsWith(long[0])).toBe(true);
    expect(h.References.length).toBeLessThanOrEqual(900);
  });
  it("keeps sending and reading as separate capabilities", () => {
    const base = { provider: "imap", status: "OFF", sendStatus: "NONE", receiveEnabled: false, revokedAt: null };
    expect(capabilityOf(base)).toBe("none");
    expect(capabilityOf({ ...base, sendStatus: "CONNECTED" })).toBe("send_only");
    expect(capabilityOf({ ...base, status: "CONNECTED", receiveEnabled: true })).toBe("receive_only");
    expect(capabilityOf({ ...base, status: "CONNECTED", receiveEnabled: true, sendStatus: "CONNECTED" })).toBe("full");
    expect(capabilityOf({ ...base, status: "CONNECTED", receiveEnabled: true, sendStatus: "CONNECTED", revokedAt: new Date() })).toBe("none");
  });
});

describe("SMTP sending mailbox", () => {
  it("connects per workspace with the password encrypted, becomes the default sender, and is invisible to another workspace", async () => {
    const w = await ws(); const other = await ws("MailSendOther");
    expect(await sendingReady(w.workspace.id)).toBe(false);
    const box = await connectMailboxSending(w.ctx, SMTP);
    expect(box).toMatchObject({ sendStatus: "CONNECTED", isDefaultSender: true, capability: "send_only", hasSmtpPassword: true, note: expect.stringContaining("no message was sent") });
    expect(JSON.stringify(box)).not.toContain("app-password-1");
    const row = await db.mailbox.findUniqueOrThrow({ where: { id: box.id } });
    expect(row.encryptedSmtpPassword).not.toContain("app-password-1");
    expect(vi.mocked(testSmtp).mock.calls[0][0]).toMatchObject({ host: SMTP.smtpHost, port: 587, secure: false, requireTls: true, from: { email: SMTP.address } });
    expect(await sendingReady(w.workspace.id)).toBe(true);
    // Sending only: stop-on-reply still needs a reader.
    expect(await readsReplies(w.workspace.id)).toBe(false);
    expect(await sendingReady(other.workspace.id)).toBe(false);
    await expect(setDefaultSender(other.ctx, box.id)).rejects.toThrow();
    expect(await listMailboxes(other.ctx)).toEqual([]);
  });

  it("records a failed check as an error, not as sending", async () => {
    const w = await ws();
    vi.mocked(testSmtp).mockResolvedValueOnce({ ok: false, code: "auth_failed", reason: "The mail server rejected the credentials.", retryable: false, adapter: "smtp" });
    const box = await connectMailboxSending(w.ctx, SMTP);
    expect(box).toMatchObject({ sendStatus: "ERROR", isDefaultSender: false, capability: "none", sendLastError: expect.stringContaining("rejected") });
    expect(await sendingReady(w.workspace.id)).toBe(false);
  });

  it("sends from the mailbox, as the mailbox, once — a redelivered job and a second worker send nothing", async () => {
    const w = await ws();
    const box = await connectMailboxSending(w.ctx, SMTP);
    const { message } = await queued(w.workspace.id, w.user.id);
    vi.mocked(sendViaSmtp).mockResolvedValue({ ok: true, providerMessageId: "<sent-1@northbridge-synthetic.example>", adapter: "smtp" });
    const [a, b] = await Promise.all([sendMessage(w.workspace.id, message.id), sendMessage(w.workspace.id, message.id)]);
    expect([a, b].filter(r => "sent" in r && r.sent)).toHaveLength(1);
    expect(sendViaSmtp).toHaveBeenCalledTimes(1);
    const [email, config] = vi.mocked(sendViaSmtp).mock.calls[0];
    expect(email.from).toEqual({ name: "Priya at Northbridge", email: SMTP.address });
    expect(config).toMatchObject({ host: SMTP.smtpHost, pass: "app-password-1", requireTls: true });
    expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ state: "SENT", mailboxId: box.id, fromAddress: SMTP.address, externalId: "<sent-1@northbridge-synthetic.example>" });
    await sendMessage(w.workspace.id, message.id);
    expect(sendViaSmtp).toHaveBeenCalledTimes(1);
  });

  it("does not resend a message whose send started and was never recorded", async () => {
    const w = await ws();
    await connectMailboxSending(w.ctx, SMTP);
    const { message } = await queued(w.workspace.id, w.user.id);
    await db.message.update({ where: { id: message.id }, data: { sendClaimedAt: new Date(Date.now() - 11 * 60_000) } });
    expect(await sendMessage(w.workspace.id, message.id)).toMatchObject({ skipped: "already_claimed" });
    expect(sendViaSmtp).not.toHaveBeenCalled();
    expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ state: "FAILED", failureReason: expect.stringContaining("Sent folder") });
  });

  it("keeps a temporary failure retryable and releases its claim", async () => {
    const w = await ws();
    await connectMailboxSending(w.ctx, SMTP);
    const { message } = await queued(w.workspace.id, w.user.id);
    vi.mocked(sendViaSmtp).mockResolvedValueOnce({ ok: false, code: "temporary", reason: "Try later.", retryable: true, adapter: "smtp" }).mockResolvedValueOnce({ ok: true, providerMessageId: "<ok@x.example>", adapter: "smtp" });
    await sendMessage(w.workspace.id, message.id);
    expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ state: "QUEUED", sendClaimedAt: null });
    await sendMessage(w.workspace.id, message.id);
    expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).state).toBe("SENT");
  });

  it("threads a follow-up to what came before", async () => {
    const w = await ws();
    await connectMailboxSending(w.ctx, SMTP);
    const { conversation, message } = await queued(w.workspace.id, w.user.id);
    await db.message.create({ data: { workspaceId: w.workspace.id, conversationId: conversation.id, direction: "OUTBOUND", channel: "EMAIL", state: "SENT", body: "first", externalId: "<first@northbridge-synthetic.example>", createdAt: new Date(Date.now() - 60_000) } });
    await db.message.create({ data: { workspaceId: w.workspace.id, conversationId: conversation.id, direction: "INBOUND", channel: "EMAIL", state: "DELIVERED", body: "reply", externalId: "<their-reply@buyer-synthetic.example>", createdAt: new Date(Date.now() - 30_000) } });
    vi.mocked(sendViaSmtp).mockResolvedValue({ ok: true, providerMessageId: "<third@x.example>", adapter: "smtp" });
    await sendMessage(w.workspace.id, message.id);
    expect(vi.mocked(sendViaSmtp).mock.calls[0][0].headers).toMatchObject({ "In-Reply-To": "<their-reply@buyer-synthetic.example>", References: "<first@northbridge-synthetic.example> <their-reply@buyer-synthetic.example>" });
  });

  it("holds a message whose chosen mailbox cannot send, instead of sending from someone else", async () => {
    const w = await ws();
    const good = await connectMailboxSending(w.ctx, SMTP);
    vi.mocked(testSmtp).mockResolvedValueOnce({ ok: false, code: "auth_failed", reason: "bad password", retryable: false, adapter: "smtp" });
    const broken = await connectMailboxSending(w.ctx, { ...SMTP, address: "rahul@northbridge-synthetic.example", smtpUser: "rahul@northbridge-synthetic.example" });
    const { message } = await queued(w.workspace.id, w.user.id, { mailboxId: broken.id });
    expect(await sendMessage(w.workspace.id, message.id)).toMatchObject({ sent: false, disposition: "hold" });
    expect(sendViaSmtp).not.toHaveBeenCalled();
    expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ state: "QUEUED", failureReason: expect.stringContaining("rahul@") });
    expect(await senderFor(w.workspace.id, null)).toMatchObject({ ok: true, mailboxId: good.id });
  });

  it("lets a sequence choose its sender, only from this workspace's working mailboxes, and queues each step once", async () => {
    const w = await ws(); const other = await ws("MailSendSeqOther");
    const box = await connectMailboxSending(w.ctx, SMTP);
    const foreign = await connectMailboxSending(other.ctx, { ...SMTP, address: "x@other-synthetic.example", smtpUser: "x@other-synthetic.example" });
    const sequence = await db.sequence.create({ data: { workspaceId: w.workspace.id, name: "Intro", isActive: true, stopOnReply: false, sendWindowStart: 0, sendWindowEnd: 24, sendDays: [1, 2, 3, 4, 5, 6, 7] } });
    await db.sequenceStep.createMany({ data: [{ workspaceId: w.workspace.id, sequenceId: sequence.id, stepOrder: 1, dayOffset: 0, channel: "EMAIL", subject: "Hello", bodyTemplate: "Hi" }, { workspaceId: w.workspace.id, sequenceId: sequence.id, stepOrder: 2, dayOffset: 3, channel: "EMAIL", subject: "Again", bodyTemplate: "Hi again" }] });
    await expect(setSequenceSender(w.ctx, sequence.id, { mailboxId: foreign.id })).rejects.toThrow();
    await setSequenceSender(w.ctx, sequence.id, { mailboxId: box.id });
    const { lead, person } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await db.contactMethod.create({ data: { workspaceId: w.workspace.id, personId: person.id, kind: "WORK_EMAIL", value: "meera@buyer-synthetic.example", maskedValue: "m***@buyer-synthetic.example", isLocked: false, source: "test" } });
    const enrollment = await db.sequenceEnrollment.create({ data: { workspaceId: w.workspace.id, sequenceId: sequence.id, leadId: lead.id, state: "active", nextSendAt: new Date(Date.now() - 1000) } });
    await advanceSequences(w.workspace.id);
    // A redelivered job after the step was queued but before the enrollment advanced.
    await db.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { currentStep: 0, nextSendAt: new Date(Date.now() - 1000), state: "active" } });
    await advanceSequences(w.workspace.id);
    const msgs = await db.message.findMany({ where: { workspaceId: w.workspace.id, direction: "OUTBOUND" } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ mailboxId: box.id, idempotencyKey: `seq:${w.workspace.id}:${enrollment.id}:${msgs[0].sequenceStepId}` });
    // Disconnecting the mailbox returns the sequence to the default and erases the password.
    await revokeMailbox(w.ctx, box.id);
    expect((await db.sequence.findUniqueOrThrow({ where: { id: sequence.id } })).senderMailboxId).toBeNull();
    expect(await db.mailbox.findUniqueOrThrow({ where: { id: box.id } })).toMatchObject({ encryptedSmtpPassword: null, sendStatus: "REVOKED", isDefaultSender: false });
    expect(await sendingReady(w.workspace.id)).toBe(false);
  });
});

describe("Gmail and Microsoft 365 over OAuth", () => {
  const replies = new Map<string, unknown>();
  function answer(match: (url: string) => boolean, body: unknown) { replies.set(randomUUID(), { match, body }); }
  beforeEach(() => {
    replies.clear();
    vi.mocked(providerJson).mockImplementation((async (_ws: string, _p: string, url: string) => {
      for (const r of replies.values() as Iterable<{ match: (u: string) => boolean; body: unknown }>) if (r.match(url)) { if (r.body instanceof Error) throw r.body; return typeof r.body === "function" ? (r.body as () => unknown)() : r.body; }
      throw new Error(`test: unexpected ${url}`);
    }) as never);
  });
  async function connect(w: Awaited<ReturnType<typeof ws>>, provider: "gmail" | "microsoft", scopes: string) {
    vi.stubEnv(provider === "gmail" ? "GOOGLE_OAUTH_CLIENT_ID" : "MICROSOFT_OAUTH_CLIENT_ID", "cid");
    vi.stubEnv(provider === "gmail" ? "GOOGLE_OAUTH_CLIENT_SECRET" : "MICROSOFT_OAUTH_CLIENT_SECRET", "csecret");
    answer(u => u.includes("/token"), { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: scopes });
    if (provider === "gmail") answer(u => u.endsWith("/users/me/profile"), { emailAddress: "Priya@Northbridge-synthetic.example", historyId: "1000" });
    else answer(u => u.includes("/v1.0/me?$select"), { mail: "priya@northbridge-synthetic.example", userPrincipalName: "priya@northbridge-synthetic.example" });
    const { url, nonce } = startMailConnect(w.ctx, provider, "https://app.example/cb");
    const state = new URL(url).searchParams.get("state")!;
    return completeMailConnect(w.ctx, provider, { code: "code-1", state, cookieNonce: nonce, redirectUri: "https://app.example/cb" });
  }

  it("refuses a callback not started from this browser, and records exactly what was granted", async () => {
    const w = await ws();
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid"); vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "cs");
    const { url } = startMailConnect(w.ctx, "gmail", "https://app.example/cb");
    expect(new URL(url).searchParams.get("scope")).toContain("gmail.send");
    await expect(completeMailConnect(w.ctx, "gmail", { code: "c", state: new URL(url).searchParams.get("state"), cookieNonce: "not-the-nonce", redirectUri: "https://app.example/cb" })).rejects.toThrow(/not started from this browser/);
    // Send granted, read refused: it sends, and does not claim to read replies.
    const r = await connect(w, "gmail", "https://www.googleapis.com/auth/gmail.send openid email");
    expect(r).toMatchObject({ canSend: true, canRead: false, address: "priya@northbridge-synthetic.example" });
    expect(await readsReplies(w.workspace.id)).toBe(false);
    expect(await sendingReady(w.workspace.id)).toBe(true);
    const row = await db.mailbox.findFirstOrThrow({ where: { workspaceId: w.workspace.id } });
    expect(row.encryptedTokens).not.toContain("at-1");
  });

  it("Gmail: sends the MIME message as base64url and stores the Message-ID Gmail used, then reads a reply that stops the sequence", async () => {
    const w = await ws();
    await connect(w, "gmail", "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly openid email");
    const { lead, message } = await queued(w.workspace.id, w.user.id);
    const seq = await db.sequence.create({ data: { workspaceId: w.workspace.id, name: "S", stopOnReply: true } });
    await db.sequenceEnrollment.create({ data: { workspaceId: w.workspace.id, sequenceId: seq.id, leadId: lead.id, state: "active", nextSendAt: new Date(Date.now() + 86400000) } });
    let raw = "";
    answer(u => u.endsWith("/messages/send"), () => ({ id: "g-1", threadId: "t-1" }));
    answer(u => u.includes("/messages/g-1?format=metadata"), { payload: { headers: [{ name: "Message-ID", value: "<CAGmail-1@mail.gmail.com>" }] } });
    vi.mocked(providerJson).mockImplementationOnce((async (_w: string, _p: string, _u: string, _h: unknown, body: { raw: string }) => { raw = Buffer.from(body.raw, "base64url").toString("utf8"); return { id: "g-1" }; }) as never);
    const sent = await sendMessage(w.workspace.id, message.id);
    expect(sent).toMatchObject({ sent: true });
    expect(raw).toMatch(/^From: priya@northbridge-synthetic\.example/m);
    expect(raw).toContain("To: meera@buyer-synthetic.example");
    expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ state: "SENT", externalId: "<CAGmail-1@mail.gmail.com>" });

    const box = await db.mailbox.findFirstOrThrow({ where: { workspaceId: w.workspace.id } });
    answer(u => u.includes("/history?startHistoryId=1000"), { history: [{ messagesAdded: [{ message: { id: "in-1" } }] }], historyId: "1010" });
    answer(u => u.includes("/messages/in-1?format=full"), { id: "in-1", payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: "Meera <meera@buyer-synthetic.example>" }, { name: "Subject", value: "Re: Following up" }, { name: "Message-ID", value: "<reply-1@buyer-synthetic.example>" }, { name: "In-Reply-To", value: "<CAGmail-1@mail.gmail.com>" }], parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Tuesday works.").toString("base64url") } }] } });
    const r = await syncMailbox(w.workspace.id, box.id);
    expect(r).toMatchObject({ read: 1, replies: 1, sequencesStopped: 1, error: null });
    expect((await db.mailbox.findUniqueOrThrow({ where: { id: box.id } })).readCursor).toBe("1010");
    // Read again from the same cursor: nothing new is recorded.
    await db.mailbox.update({ where: { id: box.id }, data: { readCursor: "1000" } });
    expect(await syncMailbox(w.workspace.id, box.id)).toMatchObject({ replies: 0 });
    expect(await db.message.count({ where: { workspaceId: w.workspace.id, direction: "INBOUND" } })).toBe(1);
  });

  it("Gmail: history too old restarts from now instead of re-reading the mailbox", async () => {
    const w = await ws();
    await connect(w, "gmail", "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly");
    const box = await db.mailbox.findFirstOrThrow({ where: { workspaceId: w.workspace.id } });
    const { ProviderRequestError } = await import("@/lib/providers/provider-errors");
    replies.clear();
    answer(u => u.includes("/history?"), new ProviderRequestError("404", "http", 404));
    answer(u => u.endsWith("/users/me/profile"), { emailAddress: "priya@northbridge-synthetic.example", historyId: "5000" });
    expect(await syncMailbox(w.workspace.id, box.id)).toMatchObject({ reset: true });
    expect((await db.mailbox.findUniqueOrThrow({ where: { id: box.id } })).readCursor).toBe("5000");
  });

  it("Microsoft Graph: creates the draft from MIME, sends it, and stores its internetMessageId; a server error is not retried", async () => {
    const w = await ws();
    await connect(w, "microsoft", "Mail.Send Mail.Read User.Read");
    const { message } = await queued(w.workspace.id, w.user.id);
    let draftBody = "";
    vi.mocked(providerJson).mockImplementationOnce((async (_w: string, _p: string, url: string, _h: unknown, _b: unknown, opts: { raw: { contentType: string; body: string } }) => { expect(url).toMatch(/\/me\/messages$/); expect(opts.raw.contentType).toBe("text/plain"); draftBody = Buffer.from(opts.raw.body, "base64").toString("utf8"); return { id: "d-1", internetMessageId: "<AM0PR-1@outlook.com>" }; }) as never);
    answer(u => u.endsWith("/messages/d-1/send"), {});
    expect(await sendMessage(w.workspace.id, message.id)).toMatchObject({ sent: true });
    expect(draftBody).toContain("Subject: Following up");
    expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).externalId).toBe("<AM0PR-1@outlook.com>");

    const second = await queued(w.workspace.id, w.user.id);
    const { ProviderRequestError } = await import("@/lib/providers/provider-errors");
    vi.mocked(providerJson).mockImplementationOnce((async () => { throw new ProviderRequestError("503", "http", 503); }) as never);
    await sendMessage(w.workspace.id, second.message.id);
    expect(await db.message.findUniqueOrThrow({ where: { id: second.message.id } })).toMatchObject({ state: "FAILED", failureReason: expect.stringContaining("Sent folder") });
  });
});
