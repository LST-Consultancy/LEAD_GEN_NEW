import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import net from "node:net";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { checkMailbox, fetchSince, quote } from "@/lib/outreach/imap";
import { classifyInbound, parseHeaders, replyText } from "@/lib/outreach/inbound";
import { connectMailbox, readsReplies, revokeMailbox, syncMailbox, testMailbox } from "@/lib/services/mailboxes";

type Mail = { uid: number; headers: string; text: string };
/** A scripted IMAP server: enough of RFC 9051 to exercise LOGIN, EXAMINE, UID SEARCH and UID FETCH with literals. */
function imapServer(opts: { user: string; pass: string; uidValidity: string }) {
  const mail: Mail[] = [];
  const commands: string[] = [];
  const server = net.createServer(socket => {
    socket.write("* OK IMAP4rev1 fixture ready\r\n");
    let buf = "";
    socket.on("data", d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const [tag, ...rest] = line.split(" "); const cmd = rest.join(" "); commands.push(cmd.startsWith("LOGIN") ? "LOGIN ***" : cmd);
        if (cmd.startsWith("LOGIN")) { socket.write(cmd === `LOGIN ${quote(opts.user)} ${quote(opts.pass)}` ? `${tag} OK logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`); continue; }
        if (cmd.startsWith("EXAMINE")) { const next = (mail.at(-1)?.uid ?? 0) + 1; socket.write(`* ${mail.length} EXISTS\r\n* OK [UIDVALIDITY ${opts.uidValidity}] ok\r\n* OK [UIDNEXT ${next}] ok\r\n${tag} OK [READ-ONLY] done\r\n`); continue; }
        if (cmd.startsWith("UID SEARCH")) {
          const from = Number(/UID (\d+):\*/.exec(cmd)![1]);
          // Like a real server, n:* always includes the newest message even when its UID is below n.
          const uids = mail.filter(m => m.uid >= from).map(m => m.uid); if (mail.length && !uids.length) uids.push(mail.at(-1)!.uid);
          socket.write(`* SEARCH ${uids.join(" ")}\r\n${tag} OK search done\r\n`); continue;
        }
        if (cmd.startsWith("UID FETCH")) {
          const wanted = /UID FETCH ([\d,]+)/.exec(cmd)![1].split(",").map(Number);
          for (const [n, m] of mail.entries()) if (wanted.includes(m.uid)) socket.write(`* ${n + 1} FETCH (UID ${m.uid} BODY[HEADER.FIELDS (FROM SUBJECT)] {${Buffer.byteLength(m.headers)}}\r\n${m.headers} BODY[TEXT]<0> {${Buffer.byteLength(m.text)}}\r\n${m.text})\r\n`);
          socket.write(`${tag} OK fetch done\r\n`); continue;
        }
        if (cmd.startsWith("LOGOUT")) { socket.write(`* BYE\r\n${tag} OK bye\r\n`); socket.end(); continue; }
        socket.write(`${tag} BAD unknown\r\n`);
      }
    });
  });
  return { server, mail, commands, add: (headers: string, text: string) => mail.push({ uid: (mail.at(-1)?.uid ?? 100) + 1, headers, text }) };
}
const listen = (s: net.Server) => new Promise<number>(r => s.listen(0, "127.0.0.1", () => r((s.address() as net.AddressInfo).port)));

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
const fx = imapServer({ user: "sales@contoso-synthetic.example", pass: 'p"ss\\word', uidValidity: "7" });
let port = 0;
beforeAll(async () => { vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32)); port = await listen(fx.server); });
afterAll(async () => { fx.server.close(); await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });

const REPLY = "From: Meera <meera@buyer-synthetic.example>\r\nSubject: Re: NetSuite help\r\nMessage-ID: <reply-1@buyer-synthetic.example>\r\nIn-Reply-To: <out-1@signalroom.test>\r\nDate: " + new Date().toUTCString() + "\r\n\r\n";
const OOO = "From: Meera <meera@buyer-synthetic.example>\r\nSubject: Automatic reply: NetSuite help\r\nMessage-ID: <ooo-1@buyer-synthetic.example>\r\nIn-Reply-To: <out-1@signalroom.test>\r\nAuto-Submitted: auto-replied\r\n\r\n";
const OTHER = "From: News <news@elsewhere.example>\r\nSubject: Weekly digest\r\nMessage-ID: <digest-1@elsewhere.example>\r\n\r\n";

describe("reading inbound messages", () => {
  it("unfolds headers, decodes encoded words and tells replies from automatic answers and bounces", () => {
    const h = parseHeaders("Subject: =?utf-8?B?UmU6IE5ldFN1aXRl?=\r\n  help\r\nFrom: A <a@b.example>\r\n");
    expect(h.subject).toBe("Re: NetSuite help");
    expect(classifyInbound(parseHeaders(REPLY))).toBe("reply");
    expect(classifyInbound(parseHeaders(OOO))).toBe("auto_reply");
    expect(classifyInbound({ from: "MAILER-DAEMON@mx.example", subject: "Undelivered" })).toBe("bounce");
    expect(classifyInbound({ from: "a@b.example", subject: "Out of office until Monday" })).toBe("auto_reply");
  });
  it("keeps what the person wrote and cuts the quoted history", () => {
    expect(replyText("Yes, let's talk Tuesday.\r\n\r\nOn Mon, 1 Sep 2026 at 10:00, Sales wrote:\r\n> Hi Meera")).toBe("Yes, let's talk Tuesday.");
  });
});

describe("the IMAP client", () => {
  it("refuses plain IMAP to anything but localhost, and quotes credentials safely", async () => {
    await expect(checkMailbox({ host: "mail.example.com", port: 143, secure: false, user: "u", pass: "p" })).rejects.toMatchObject({ kind: "insecure" });
    expect(quote('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(() => quote("a\r\nb")).toThrow();
  });
  it("reads literals in full and never re-reads the newest message", async () => {
    fx.add("From: x <x@y.example>\r\nSubject: first\r\n\r\n", "line one\r\nline two with {braces}\r\n");
    const cfg = { host: "127.0.0.1", port, secure: false, user: "sales@contoso-synthetic.example", pass: 'p"ss\\word' };
    const first = await fetchSince(cfg, 0);
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0].text).toContain("line two with {braces}");
    expect((await fetchSince(cfg, first.highestUid)).messages).toHaveLength(0);
    await expect(checkMailbox({ ...cfg, pass: "wrong" })).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("mailbox reply reading", () => {
  it("records a reply once, stops stop-on-reply sequences once, and ignores automatic answers and unrelated mail", async () => {
    const w = await makeWorkspace("Mailbox"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const other = await makeWorkspace("MailboxOther"); created.workspaceIds.push(other.workspace.id); created.userIds.push(other.user.id); created.planIds.push(other.plan.id);
    const company = await db.company.create({ data: { workspaceId: w.workspace.id, name: "Buyer Synthetic", country: "Unknown" } });
    const person = await db.person.create({ data: { workspaceId: w.workspace.id, fullName: "Meera Synthetic", country: "Unknown" } });
    const lead = await db.lead.create({ data: { workspaceId: w.workspace.id, companyId: company.id, personId: person.id, ownerId: w.user.id, surfacedReason: "fixture" } });
    const conversation = await db.conversation.create({ data: { workspaceId: w.workspace.id, channel: "EMAIL", leadId: lead.id, companyId: company.id } });
    await db.message.create({ data: { workspaceId: w.workspace.id, conversationId: conversation.id, direction: "OUTBOUND", channel: "EMAIL", state: "SENT", body: "Hi Meera", externalId: "<out-1@signalroom.test>", sentAt: new Date() } });
    const sequence = await db.sequence.create({ data: { workspaceId: w.workspace.id, name: "Follow-up", stopOnReply: true } });
    const enrollment = await db.sequenceEnrollment.create({ data: { workspaceId: w.workspace.id, sequenceId: sequence.id, leadId: lead.id, state: "active", nextSendAt: new Date(Date.now() + 86400000) } });

    expect(await readsReplies(w.workspace.id)).toBe(false);
    const box = await connectMailbox(w.ctx, { label: "Sales", address: "sales@contoso-synthetic.example", imapHost: "127.0.0.1", imapPort: port, imapSecure: false, imapUser: "sales@contoso-synthetic.example", password: 'p"ss\\word' });
    expect(box).toMatchObject({ status: "CONNECTED", hasPassword: true });
    expect(box).not.toHaveProperty("encryptedPassword");
    expect(await readsReplies(w.workspace.id)).toBe(true);
    await expect(testMailbox(other.ctx, box.id)).rejects.toThrow();

    // Mail that arrives after connecting.
    fx.add(REPLY, "Yes, let's talk Tuesday.\r\n\r\nOn Mon, Sales wrote:\r\n> Hi Meera\r\n");
    fx.add(OOO, "I am away until Monday.\r\n");
    fx.add(OTHER, "News.\r\n");
    const r = await syncMailbox(w.workspace.id, box.id);
    expect(r).toMatchObject({ read: 3, replies: 1, autoReplies: 1, unmatched: 1, sequencesStopped: 1, error: null });
    expect(await db.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).toMatchObject({ state: "replied", nextSendAt: null });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).repliedAt).not.toBeNull();
    const inbound = await db.message.findMany({ where: { workspaceId: w.workspace.id, direction: "INBOUND" }, orderBy: { createdAt: "asc" } });
    expect(inbound.map(m => m.body)).toEqual(["Yes, let's talk Tuesday.", "I am away until Monday."]);
    // Read-only: nothing flagged, moved or deleted.
    expect(fx.commands.some(c => /STORE|EXPUNGE|MOVE|SELECT /.test(c))).toBe(false);

    // A redelivered job that re-reads the same UIDs changes nothing.
    await db.mailbox.update({ where: { id: box.id }, data: { lastUid: 101 } });
    expect(await syncMailbox(w.workspace.id, box.id)).toMatchObject({ replies: 0, sequencesStopped: 0 });
    expect(await db.message.count({ where: { workspaceId: w.workspace.id, direction: "INBOUND" } })).toBe(2);

    await revokeMailbox(w.ctx, box.id);
    expect(await readsReplies(w.workspace.id)).toBe(false);
    expect(await db.mailbox.findUniqueOrThrow({ where: { id: box.id } })).toMatchObject({ encryptedPassword: null, status: "REVOKED" });
  });
});
