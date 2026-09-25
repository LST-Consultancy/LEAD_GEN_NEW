import "server-only";
import net from "node:net";
import tls from "node:tls";
import { buildMessage, dotStuff, messageId, type OutgoingEmail } from "@/lib/outreach/mime";
import type { SendFailure, SendOutcome } from "@/lib/outreach/transport";

/**
 * §48 — SMTP, spoken directly.
 *
 * No dependency: the protocol is a dozen line-oriented commands, and a mail
 * library is a large amount of surface for that. Written against RFC 5321 and
 * tested against a real SMTP conversation in `tests/smtp.test.ts`.
 *
 * The parts that matter:
 *
 *  - **A reply can span several lines.** `250-SIZE` continues; `250 SIZE` ends.
 *    Treating the first line as the whole reply makes EHLO capability
 *    detection wrong, and STARTTLS gets skipped on a server that offers it.
 *  - **STARTTLS is used whenever offered**, and its failure is fatal rather
 *    than a silent downgrade — the downgrade is the attack.
 *  - **Every code is classified.** 4xx is temporary and worth retrying; 5xx is
 *    permanent and retrying it damages sender reputation. 535 is specifically
 *    an authentication failure, which no amount of retrying fixes.
 */

const CRLF = "\r\n";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: { name?: string; email: string };
  timeoutMs: number;
  /** Refuse to authenticate unless the session is encrypted. Always true for workspace mailboxes. */
  requireTls?: boolean;
};

/**
 * `SMTP_URL` in the form `smtp://user:pass@host:port` or `smtps://…`.
 *
 * A URL rather than five variables: one value to set, one to get wrong, and it
 * is what every other tool already accepts.
 */
export function parseSmtpUrl(raw: string | undefined, fromAddress?: string): SmtpConfig | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "smtp:" && url.protocol !== "smtps:") return null;

  const secure = url.protocol === "smtps:";
  const from = fromAddress ?? process.env.EMAIL_FROM ?? "";
  if (!from.includes("@")) return null;

  return {
    host: url.hostname,
    // 465 is implicit TLS, 587 is submission with STARTTLS. Both are standard;
    // 25 is server-to-server and usually blocked for submission.
    port: Number(url.port) || (secure ? 465 : 587),
    secure,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    pass: url.password ? decodeURIComponent(url.password) : undefined,
    from: { name: process.env.EMAIL_FROM_NAME || undefined, email: from },
    timeoutMs: Number(process.env.SMTP_TIMEOUT_MS) || 20_000,
  };
}

/**
 * Sends one message. With `mailbox`, through that workspace mailbox's own SMTP server and account
 * (always TLS: implicit on 465, or STARTTLS, which is then required); otherwise the server relay.
 */
export async function sendViaSmtp(email: OutgoingEmail, mailbox?: SmtpConfig): Promise<SendOutcome> {
  const config = mailbox ?? parseSmtpUrl(process.env.SMTP_URL, email.from.email);
  if (!config) {
    return {
      ok: false,
      code: "not_configured",
      reason:
        "SMTP_URL is missing or malformed, or EMAIL_FROM is not a valid address. Expected smtp://user:pass@host:port. Nothing was sent.",
      retryable: false,
      adapter: "smtp",
    };
  }

  const id = messageId(config.from.email.split("@")[1] ?? "localhost");
  const payload = buildMessage({ ...email, from: email.from ?? config.from }, { messageId: id });

  return runSession(config, email, payload, id);
}

/**
 * Checks a mailbox's SMTP settings without sending anything: connect, EHLO, STARTTLS, log in, QUIT.
 * A server that accepts the login may still refuse a particular From address; that is only known
 * when a message is sent.
 */
export async function testSmtp(config: SmtpConfig): Promise<SendOutcome> {
  return runSession(config, null, "", "");
}

/** One connection, one message. Connection reuse is a later optimisation. */
async function runSession(
  config: SmtpConfig,
  email: OutgoingEmail | null,
  payload: string,
  id: string
): Promise<SendOutcome> {
  return new Promise<SendOutcome>((resolve) => {
    let socket: net.Socket | tls.TLSSocket;
    let settled = false;
    let buffer = "";
    let waiting: ((reply: Reply) => void) | null = null;

    const finish = (outcome: SendOutcome) => {
      if (settled) return;
      settled = true;
      try {
        socket?.destroy();
      } catch {
        // Already gone; the outcome is what matters.
      }
      resolve(outcome);
    };

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          code: "timeout",
          reason: `The mail server did not respond within ${Math.round(config.timeoutMs / 1000)} seconds. Nothing was sent.`,
          retryable: true,
          adapter: "smtp",
        }),
      config.timeoutMs
    );

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      // A reply ends on a line whose 4th character is a space rather than a
      // dash. Anything else is a continuation.
      const lines = buffer.split(CRLF);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length >= 4 && line[3] === " ") {
          const complete = lines.slice(0, i + 1).join(CRLF);
          buffer = lines.slice(i + 1).join(CRLF);
          const reply = parseReply(complete);
          const handler = waiting;
          waiting = null;
          handler?.(reply);
          return;
        }
      }
    };

    const expect = (): Promise<Reply> => new Promise((r) => (waiting = r));
    const say = (command: string) => socket.write(command + CRLF);

    const fail = (reply: Reply, context: string) =>
      finish({
        ok: false,
        ...classify(reply, context),
        adapter: "smtp",
      });

    const connect = config.secure
      ? () => tls.connect({ host: config.host, port: config.port, servername: config.host })
      : () => net.connect({ host: config.host, port: config.port });

    socket = connect();
    socket.setEncoding("utf8");
    socket.on("data", onData);
    socket.on("error", (err) =>
      finish({
        ok: false,
        code: "connection_failed",
        reason: `Could not reach ${config.host}:${config.port} — ${err.message}. Nothing was sent.`,
        retryable: true,
        adapter: "smtp",
      })
    );

    socket.on("connect", () => void converse());
    socket.on("secureConnect", () => void converse());

    async function converse() {
      try {
        const greeting = await expect();
        if (greeting.code !== 220) return fail(greeting, "on connecting");

        let ehlo = await command(`EHLO ${hostnameFor(config.from.email)}`);
        if (ehlo.code !== 250) return fail(ehlo, "at EHLO");

        // STARTTLS whenever offered on a plaintext connection. A server that
        // advertises it and is then spoken to in clear is the downgrade this
        // guards against.
        if (!config.secure && /STARTTLS/i.test(ehlo.text)) {
          const ready = await command("STARTTLS");
          if (ready.code !== 220) return fail(ready, "at STARTTLS");

          const plain = socket as net.Socket;
          plain.removeListener("data", onData);
          const upgraded = tls.connect({ socket: plain, servername: config.host });
          upgraded.on("error", (err) =>
            finish({
              ok: false,
              code: "connection_failed",
              reason: `TLS negotiation with ${config.host} failed — ${err.message}. Nothing was sent, and it was not retried in clear.`,
              retryable: true,
              adapter: "smtp",
            })
          );
          await new Promise<void>((r) => upgraded.once("secureConnect", () => r()));
          socket = upgraded;
          socket.setEncoding("utf8");
          socket.on("data", onData);
          buffer = "";

          // EHLO again: capabilities and the session reset after TLS.
          ehlo = await command(`EHLO ${hostnameFor(config.from.email)}`);
          if (ehlo.code !== 250) return fail(ehlo, "at EHLO after STARTTLS");
        }

        // A mailbox's own server must never be spoken to in clear: its password is on the wire.
        if (config.requireTls && !config.secure && !(socket instanceof tls.TLSSocket)) {
          return finish({ ok: false, code: "connection_failed", reason: `${config.host} did not offer STARTTLS, so the password was not sent. Use port 465 (TLS) or a server that supports STARTTLS. Nothing was sent.`, retryable: false, adapter: "smtp" });
        }

        if (config.user && config.pass) {
          const auth = await authenticate(ehlo.text, config.user, config.pass);
          if (auth) return fail(auth, "at authentication");
        }

        if (!email) {
          clearTimeout(timer);
          settled = true;
          socket.end(`QUIT${CRLF}`);
          resolve({ ok: true, providerMessageId: "", adapter: "smtp" });
          return;
        }

        const mailFrom = await command(`MAIL FROM:<${config.from.email}>`);
        if (mailFrom.code !== 250) return fail(mailFrom, "at MAIL FROM");

        const rcpt = await command(`RCPT TO:<${email.to.email}>`);
        if (rcpt.code !== 250 && rcpt.code !== 251) return fail(rcpt, "at RCPT TO");

        const data = await command("DATA");
        if (data.code !== 354) return fail(data, "at DATA");

        // Dot-stuffed, then terminated by a lone dot on its own line.
        socket.write(dotStuff(payload) + CRLF + "." + CRLF);
        const accepted = await expect();
        if (accepted.code !== 250) return fail(accepted, "after the message body");

        // `end()` rather than `write()` then destroy: a destroyed socket can
        // drop the QUIT before it flushes, leaving the server to time the
        // connection out instead of closing it. The message is already
        // accepted, so its reply is not worth waiting for.
        clearTimeout(timer);
        settled = true;
        socket.end(`QUIT${CRLF}`);
        resolve({ ok: true, providerMessageId: id, adapter: "smtp" });
      } catch (err) {
        finish({
          ok: false,
          code: "connection_failed",
          reason: `The SMTP conversation failed — ${err instanceof Error ? err.message : "unknown error"}. Nothing was sent.`,
          retryable: true,
          adapter: "smtp",
        });
      } finally {
        clearTimeout(timer);
      }
    }

    async function command(line: string): Promise<Reply> {
      const reply = expect();
      say(line);
      return reply;
    }

    /** Returns a failing reply, or null on success. */
    async function authenticate(caps: string, user: string, pass: string): Promise<Reply | null> {
      if (/AUTH[^\r\n]*PLAIN/i.test(caps)) {
        const token = Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64");
        const reply = await command(`AUTH PLAIN ${token}`);
        return reply.code === 235 ? null : reply;
      }
      if (/AUTH[^\r\n]*LOGIN/i.test(caps)) {
        const start = await command("AUTH LOGIN");
        if (start.code !== 334) return start;
        const userReply = await command(Buffer.from(user, "utf8").toString("base64"));
        if (userReply.code !== 334) return userReply;
        const passReply = await command(Buffer.from(pass, "utf8").toString("base64"));
        return passReply.code === 235 ? null : passReply;
      }
      return {
        code: 504,
        text: "The server offered no authentication method this adapter supports (PLAIN or LOGIN).",
      };
    }
  });
}

type Reply = { code: number; text: string };

export function parseReply(raw: string): Reply {
  const lines = raw.split(CRLF).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return { code: Number(last.slice(0, 3)) || 0, text: lines.join(" ") };
}

/**
 * Turns a reply into an outcome, including whether to try again.
 *
 * Retrying a 5xx is how a sender's reputation degrades: the receiving side sees
 * repeated attempts at something it has already refused permanently.
 */
export function classify(
  reply: Reply,
  context: string
): { code: SendFailure; reason: string; retryable: boolean } {
  // `text` already begins with the code, so it is not repeated here.
  const detail = `${context}: ${reply.text.slice(0, 200)}`;

  if (reply.code === 535 || reply.code === 534 || reply.code === 530) {
    return {
      code: "auth_failed",
      reason: `The mail server rejected the credentials ${detail}. Nothing was sent, and retrying will not help until SMTP_URL is corrected.`,
      retryable: false,
    };
  }
  if (reply.code === 550 && /sender|from/i.test(reply.text)) {
    return {
      code: "rejected_sender",
      reason: `The mail server refused the sender address ${detail}. Nothing was sent — usually the From address is not one this mailbox may send as.`,
      retryable: false,
    };
  }
  if (reply.code === 550 || reply.code === 551 || reply.code === 553) {
    return {
      code: "rejected_recipient",
      reason: `The mail server refused the recipient ${detail}. Nothing was sent; treat this address as undeliverable rather than retrying.`,
      retryable: false,
    };
  }
  if (reply.code >= 400 && reply.code < 500) {
    return {
      code: "temporary",
      reason: `The mail server asked to try later ${detail}. Nothing was sent yet.`,
      retryable: true,
    };
  }
  return {
    code: "permanent",
    reason: `The mail server refused the message ${detail}. Nothing was sent, and retrying it unchanged will not help.`,
    retryable: false,
  };
}

/** The EHLO argument. Servers reject an obviously bogus one. */
function hostnameFor(email: string): string {
  return email.split("@")[1] ?? "localhost";
}
