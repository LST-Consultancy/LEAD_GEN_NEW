import net from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sendMessage } from "@/lib/queue/handlers/outreach";
import { cleanup, db as fixtureDb, makeLead, makeWorkspace } from "./helpers/fixtures";

/**
 * The whole send path, from a queued message to bytes on a socket.
 *
 * Every other test proves a piece: the rules decide correctly, the MIME is
 * well-formed, the adapter speaks SMTP. This is the only one that proves they
 * are joined up — that a message which passes the checks actually leaves, and
 * that the row afterwards says so truthfully.
 *
 * It runs against a real SMTP server on loopback, so "sent" means a server
 * received the message, not that a mock was called.
 */

type Captured = { body: string; recipients: string[] };

function mailServer(behaviour: "accept" | "reject-recipient" | "defer" = "accept") {
  const captured: Captured = { body: "", recipients: [] };
  let inData = false;

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 loopback ESMTP\r\n");
    let buffer = "";

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 2.0.0 Ok: queued as LOOPBACK1\r\n");
          } else captured.body += line + "\r\n";
          continue;
        }

        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO") socket.write("250-loopback\r\n250 AUTH PLAIN\r\n");
        else if (verb === "AUTH") socket.write("235 2.7.0 Accepted\r\n");
        else if (verb === "RCPT") {
          captured.recipients.push(line);
          if (behaviour === "reject-recipient") socket.write("550 5.1.1 No such user\r\n");
          else if (behaviour === "defer") socket.write("451 4.3.0 Try again later\r\n");
          else socket.write("250 OK\r\n");
        } else if (verb === "DATA") {
          socket.write("354 Go ahead\r\n");
          inData = true;
        } else if (verb === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else socket.write("250 OK\r\n");
      }
    });
    socket.on("error", () => {});
  });

  return { server, captured };
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as net.AddressInfo).port;
}

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
let server: net.Server | null = null;

beforeAll(() => {
  vi.stubEnv("EMAIL_PROVIDER", "smtp");
  vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");
});

afterEach(() => {
  server?.close();
  server = null;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await cleanup(created);
  await fixtureDb.$disconnect();
});

/** A queued, sendable message on a fresh workspace. */
async function queuedMessage() {
  const w = await makeWorkspace("SendE2E");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  const workspace = w.workspace;

  const { lead, person, company } = await makeLead(workspace.id, { ownerId: w.user.id });
  await fixtureDb.contactMethod.create({
    data: {
      workspaceId: workspace.id,
      personId: person.id,
      kind: "WORK_EMAIL",
      value: "priya@vaitarna.example",
      maskedValue: "p•••@vaitarna.example",
      isLocked: false,
      status: "VERIFIED",
      confidence: 90,
      source: "test",
    },
  });

  const conversation = await fixtureDb.conversation.create({
    data: {
      workspaceId: workspace.id,
      channel: "EMAIL",
      subject: "About your CRM rollout",
      state: "NEEDS_YOU",
      leadId: lead.id,
      companyId: company.id,
    },
  });

  const message = await fixtureDb.message.create({
    data: {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      channel: "EMAIL",
      state: "QUEUED",
      fromAddress: "rahul@northbridge.example",
      toAddress: "priya@vaitarna.example",
      subject: "About your ₹18 lakh rollout",
      body: "Hello Priya,\n\n.a dot-led line\n\nRahul\n",
    },
  });

  return { workspace, lead, message };
}

describe("a queued message, sent for real", () => {
  it("reaches the mail server and is recorded as sent", async () => {
    const { server: s, captured } = mailServer("accept");
    server = s;
    const port = await listen(s);
    vi.stubEnv("SMTP_URL", `smtp://user:pass@127.0.0.1:${port}`);

    const { workspace, lead, message } = await queuedMessage();
    const result = await sendMessage(workspace.id, message.id);

    expect(result.sent, JSON.stringify(result)).toBe(true);

    const after = await fixtureDb.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.state).toBe("SENT");
    expect(after.sentAt).not.toBeNull();
    expect(after.failureReason).toBeNull();
    // The provider's id, which a bounce or delivery receipt references.
    expect(after.externalId).toBeTruthy();

    // The server actually received it, correctly encoded.
    expect(captured.recipients.join()).toContain("priya@vaitarna.example");
    expect(captured.body).toContain("Subject: =?UTF-8?B?");
    expect(captured.body).toContain("..a dot-led line");

    // Contacting someone is what every "went quiet" rule reads.
    const touched = await fixtureDb.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(touched.lastContactedAt).not.toBeNull();
  });

  it("is idempotent: a redelivered job does not send twice", async () => {
    const { server: s, captured } = mailServer("accept");
    server = s;
    const port = await listen(s);
    vi.stubEnv("SMTP_URL", `smtp://user:pass@127.0.0.1:${port}`);

    const { workspace, message } = await queuedMessage();
    await sendMessage(workspace.id, message.id);
    const firstBody = captured.body;

    // BullMQ redelivers a job whose worker died mid-flight. The state check is
    // what makes that harmless, not the dedupe key on the enqueue.
    const second = await sendMessage(workspace.id, message.id);
    expect(second).toMatchObject({ skipped: "not_queued" });
    expect(captured.body).toBe(firstBody);
  });

  it("keeps a deferred message queued so a later pass retries it", async () => {
    const { server: s } = mailServer("defer");
    server = s;
    const port = await listen(s);
    vi.stubEnv("SMTP_URL", `smtp://user:pass@127.0.0.1:${port}`);

    const { workspace, message } = await queuedMessage();
    const result = await sendMessage(workspace.id, message.id);

    expect(result).toMatchObject({ sent: false, willRetry: true });
    const after = await fixtureDb.message.findUniqueOrThrow({ where: { id: message.id } });
    // Still QUEUED: a 4xx means try later, and failing it would lose a
    // legitimate message.
    expect(after.state).toBe("QUEUED");
    expect(after.sentAt).toBeNull();
  });

  it("marks a refused recipient as bounced and does not retry", async () => {
    const { server: s } = mailServer("reject-recipient");
    server = s;
    const port = await listen(s);
    vi.stubEnv("SMTP_URL", `smtp://user:pass@127.0.0.1:${port}`);

    const { workspace, message } = await queuedMessage();
    const result = await sendMessage(workspace.id, message.id);

    expect(result).toMatchObject({ sent: false, willRetry: false });
    const after = await fixtureDb.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.state).toBe("FAILED");
    // Recorded against the message so the next send sees it. Retrying a
    // permanent rejection is how a sender's reputation degrades.
    expect(after.bouncedAt).not.toBeNull();
  });

  it("fails without sending when the relay is unreachable", async () => {
    vi.stubEnv("SMTP_URL", "smtp://user:pass@127.0.0.1:1");

    const { workspace, message } = await queuedMessage();
    const result = await sendMessage(workspace.id, message.id);

    expect(result.sent).toBe(false);
    const after = await fixtureDb.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.sentAt).toBeNull();
    // Retryable, so it stays queued rather than being lost to a blip.
    expect(after.state).toBe("QUEUED");
  });
});
