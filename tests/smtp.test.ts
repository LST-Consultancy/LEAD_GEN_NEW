import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classify, parseReply, parseSmtpUrl } from "@/lib/outreach/adapters/smtp";

/**
 * SMTP, against a real server speaking the real protocol.
 *
 * A mocked transport would only prove the adapter calls a function. This starts
 * an actual TCP server on a loopback port, speaks RFC 5321 back at the adapter,
 * and records every command it received — so the assertions are about the
 * bytes that would go to a mail relay.
 *
 * The scripted server is deliberately strict about multi-line replies, because
 * that is the part most easy to get wrong and most damaging when wrong: miss it
 * and STARTTLS is never detected, so mail goes out in clear.
 */

type Session = { commands: string[]; body: string };

/**
 * A minimal SMTP server.
 *
 * `replies` maps a command verb to what to say. Anything unlisted gets 250 OK,
 * which keeps each test about the one thing it is testing.
 */
function scriptedServer(replies: Record<string, string> = {}) {
  const session: Session = { commands: [], body: "" };
  let inData = false;

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 test.local ESMTP ready\r\n");

    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 2.0.0 Ok: queued as ABC123\r\n");
          } else {
            session.body += line + "\r\n";
          }
          continue;
        }

        session.commands.push(line);
        const verb = line.split(" ")[0].toUpperCase();

        if (replies[verb]) {
          socket.write(replies[verb]);
          if (replies[verb].startsWith("354")) inData = true;
          continue;
        }

        if (verb === "AUTH") {
          // 235 is the only success code for authentication; the adapter is
          // right to refuse anything else.
          socket.write("235 2.7.0 Authentication successful\r\n");
        } else if (verb === "EHLO") {
          // Multi-line: the continuation dashes are the point.
          socket.write("250-test.local\r\n250-SIZE 35882577\r\n250 AUTH PLAIN LOGIN\r\n");
        } else if (verb === "DATA") {
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          inData = true;
        } else if (verb === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
    socket.on("error", () => {
      // A destroyed socket at the end of a test is expected.
    });
  });

  return { server, session };
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

const EMAIL = {
  from: { name: "Rahul Deshpande", email: "rahul@northbridge.example" },
  to: { name: "Priya Menon", email: "priya@vaitarna.example" },
  subject: "Quick question about your NetSuite rollout",
  text: "Hello Priya,\n\n.a line that starts with a dot\n\nRahul\n",
};

/** Imported lazily so the env stubs are in place before the module reads them. */
async function send() {
  const { sendViaSmtp } = await import("@/lib/outreach/adapters/smtp");
  return sendViaSmtp(EMAIL);
}

afterEach(() => vi.unstubAllEnvs());

describe("the SMTP adapter, against a real server", () => {
  it("completes a full conversation and reports success", async () => {
    const { server, session } = scriptedServer();
    const port = await listen(server);
    try {
      vi.stubEnv("SMTP_URL", `smtp://user:pass@127.0.0.1:${port}`);
      vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");

      const result = await send();
      expect(result.ok, JSON.stringify(result)).toBe(true);

      const verbs = session.commands.map((c) => c.split(" ")[0].toUpperCase());
      // The commands delivery actually depends on. QUIT is courtesy and is
      // written as the socket closes, so asserting it here races the server.
      expect(verbs).toEqual(expect.arrayContaining(["EHLO", "AUTH", "MAIL", "RCPT", "DATA"]));
      // Order matters: a relay refuses RCPT before MAIL.
      expect(verbs.indexOf("MAIL")).toBeLessThan(verbs.indexOf("RCPT"));
      expect(verbs.indexOf("RCPT")).toBeLessThan(verbs.indexOf("DATA"));
    } finally {
      server.close();
    }
  });

  it("closes the session politely with QUIT", async () => {
    const { server, session } = scriptedServer();
    const port = await listen(server);
    try {
      vi.stubEnv("SMTP_URL", `smtp://user:pass@127.0.0.1:${port}`);
      vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");
      await send();

      // Written as the socket closes, so give it a moment to arrive. Without
      // QUIT the server holds the connection until its own idle timeout.
      await vi.waitFor(() =>
        expect(session.commands.some((c) => c.toUpperCase().startsWith("QUIT"))).toBe(true)
      );
    } finally {
      server.close();
    }
  });

  it("sends the envelope addresses in angle brackets", async () => {
    const { server, session } = scriptedServer();
    const port = await listen(server);
    try {
      vi.stubEnv("SMTP_URL", `smtp://user:pass@127.0.0.1:${port}`);
      vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");
      await send();

      expect(session.commands).toContain("MAIL FROM:<rahul@northbridge.example>");
      expect(session.commands).toContain("RCPT TO:<priya@vaitarna.example>");
    } finally {
      server.close();
    }
  });

  it("dot-stuffs a body line that begins with a dot", async () => {
    const { server, session } = scriptedServer();
    const port = await listen(server);
    try {
      vi.stubEnv("SMTP_URL", `smtp://user:pass@127.0.0.1:${port}`);
      vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");
      await send();

      // Without stuffing, the server would have seen a lone "." and truncated
      // the message at that line.
      expect(session.body).toContain("..a line that starts with a dot");
      expect(session.body).toContain("Subject:");
    } finally {
      server.close();
    }
  });

  it("authenticates with PLAIN when the server offers it", async () => {
    const { server, session } = scriptedServer();
    const port = await listen(server);
    try {
      vi.stubEnv("SMTP_URL", `smtp://user:secret@127.0.0.1:${port}`);
      vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");
      await send();

      const auth = session.commands.find((c) => c.startsWith("AUTH PLAIN"));
      expect(auth).toBeTruthy();
      const token = auth!.split(" ")[2];
      expect(Buffer.from(token, "base64").toString("utf8")).toBe("\0user\0secret");
    } finally {
      server.close();
    }
  });

  it("skips authentication when no credentials are supplied", async () => {
    const { server, session } = scriptedServer();
    const port = await listen(server);
    try {
      vi.stubEnv("SMTP_URL", `smtp://127.0.0.1:${port}`);
      vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");
      await send();

      expect(session.commands.some((c) => c.startsWith("AUTH"))).toBe(false);
    } finally {
      server.close();
    }
  });

  it("treats a 4xx as temporary and worth retrying", async () => {
    const { server } = scriptedServer({ "MAIL": "451 4.3.0 Try again later\r\n" });
    const port = await listen(server);
    try {
      vi.stubEnv("SMTP_URL", `smtp://user:pass@127.0.0.1:${port}`);
      vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");

      const result = await send();
      expect(result).toMatchObject({ ok: false, code: "temporary", retryable: true });
    } finally {
      server.close();
    }
  });

  it("treats a rejected recipient as permanent, so it is not retried", async () => {
    const { server } = scriptedServer({ "RCPT": "550 5.1.1 No such user\r\n" });
    const port = await listen(server);
    try {
      vi.stubEnv("SMTP_URL", `smtp://user:pass@127.0.0.1:${port}`);
      vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");

      const result = await send();
      // Retrying a permanent rejection is how a sender's reputation degrades.
      expect(result).toMatchObject({ ok: false, code: "rejected_recipient", retryable: false });
    } finally {
      server.close();
    }
  });

  it("treats a bad password as fatal rather than retryable", async () => {
    const { server } = scriptedServer({ "AUTH": "535 5.7.8 Authentication credentials invalid\r\n" });
    const port = await listen(server);
    try {
      vi.stubEnv("SMTP_URL", `smtp://user:wrong@127.0.0.1:${port}`);
      vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");

      const result = await send();
      expect(result).toMatchObject({ ok: false, code: "auth_failed", retryable: false });
      if (!result.ok) expect(result.reason).toContain("SMTP_URL");
    } finally {
      server.close();
    }
  });

  it("fails with a reason rather than throwing when nothing is listening", async () => {
    // Port 1 on loopback refuses immediately.
    vi.stubEnv("SMTP_URL", "smtp://user:pass@127.0.0.1:1");
    vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");

    const result = await send();
    expect(result).toMatchObject({ ok: false, retryable: true });
    if (!result.ok) expect(result.reason).toContain("Nothing was sent");
  });

  it("refuses to send when SMTP_URL is missing", async () => {
    vi.stubEnv("SMTP_URL", "");
    vi.stubEnv("EMAIL_FROM", "rahul@northbridge.example");

    const result = await send();
    expect(result).toMatchObject({ ok: false, code: "not_configured", retryable: false });
  });
});

describe("parseReply", () => {
  it("reads the code from a single-line reply", () => {
    expect(parseReply("250 OK\r\n")).toMatchObject({ code: 250 });
  });

  it("reads a multi-line reply and keeps every line's text", () => {
    // Taking only the first line here is what makes STARTTLS detection fail.
    const reply = parseReply("250-test.local\r\n250-SIZE 100\r\n250 STARTTLS\r\n");
    expect(reply.code).toBe(250);
    expect(reply.text).toContain("SIZE");
    expect(reply.text).toContain("STARTTLS");
  });

  it("reports 0 rather than NaN for a malformed reply", () => {
    expect(parseReply("garbage\r\n").code).toBe(0);
  });
});

describe("parseSmtpUrl", () => {
  it("defaults to 587 for smtp and 465 for smtps", () => {
    expect(parseSmtpUrl("smtp://u:p@host", "a@b.test")?.port).toBe(587);
    expect(parseSmtpUrl("smtps://u:p@host", "a@b.test")?.port).toBe(465);
  });

  it("honours an explicit port", () => {
    expect(parseSmtpUrl("smtp://u:p@host:2525", "a@b.test")?.port).toBe(2525);
  });

  it("decodes credentials, so a password with @ or : works", () => {
    const config = parseSmtpUrl("smtp://user%40corp:p%3Ass@host", "a@b.test");
    expect(config?.user).toBe("user@corp");
    expect(config?.pass).toBe("p:ss");
  });

  it("rejects a non-SMTP scheme and a malformed URL", () => {
    expect(parseSmtpUrl("https://host", "a@b.test")).toBeNull();
    expect(parseSmtpUrl("not a url", "a@b.test")).toBeNull();
    expect(parseSmtpUrl(undefined, "a@b.test")).toBeNull();
  });

  it("refuses a from-address that is not an address", () => {
    // Otherwise the envelope sender is nonsense and every relay refuses it.
    expect(parseSmtpUrl("smtp://u:p@host", "not-an-address")).toBeNull();
  });
});

describe("classify", () => {
  it("separates a sender rejection from a recipient one", () => {
    expect(classify({ code: 550, text: "550 sender address rejected" }, "x").code).toBe(
      "rejected_sender"
    );
    expect(classify({ code: 550, text: "550 no such mailbox" }, "x").code).toBe(
      "rejected_recipient"
    );
  });

  it("marks only 4xx as retryable", () => {
    expect(classify({ code: 421, text: "" }, "x").retryable).toBe(true);
    expect(classify({ code: 554, text: "" }, "x").retryable).toBe(false);
  });

  it("always says nothing was sent", () => {
    for (const code of [421, 535, 550, 554]) {
      expect(classify({ code, text: "" }, "at RCPT TO").reason).toContain("Nothing was sent");
    }
  });
});
