import { describe, expect, it } from "vitest";
import {
  buildMessage,
  dotStuff,
  encodeHeaderValue,
  formatAddress,
  isAscii,
  messageId,
  quotedPrintable,
  toCrlf,
} from "@/lib/outreach/mime";

describe("encodeHeaderValue", () => {
  it("leaves plain ASCII alone, so a raw dump stays readable", () => {
    expect(encodeHeaderValue("Quick question about NetSuite")).toBe(
      "Quick question about NetSuite"
    );
  });

  it("encodes a rupee sign, which would otherwise be mangled", () => {
    const encoded = encodeHeaderValue("Proposal — ₹18 lakh");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    const b64 = /=\?UTF-8\?B\?(.+)\?=/.exec(encoded)![1];
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe("Proposal — ₹18 lakh");
  });

  it("encodes Devanagari", () => {
    const encoded = encodeHeaderValue("नमस्ते");
    const b64 = /=\?UTF-8\?B\?(.+)\?=/.exec(encoded)![1];
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe("नमस्ते");
  });
});

describe("formatAddress", () => {
  it("returns a bare address when there is no display name", () => {
    expect(formatAddress({ email: "priya@vaitarna.example" })).toBe("priya@vaitarna.example");
  });

  it("formats an ordinary name", () => {
    expect(formatAddress({ name: "Priya Menon", email: "priya@vaitarna.example" })).toBe(
      "Priya Menon <priya@vaitarna.example>"
    );
  });

  it("quotes a name containing a comma, which would otherwise split the header", () => {
    // Unquoted, "Menon, Priya" reads as two addresses and the message goes to
    // the wrong place or is rejected.
    expect(formatAddress({ name: "Menon, Priya", email: "p@x.test" })).toBe(
      '"Menon, Priya" <p@x.test>'
    );
  });

  it("escapes a quote inside a display name", () => {
    expect(formatAddress({ name: 'Priya "PM" Menon', email: "p@x.test" })).toBe(
      '"Priya \\"PM\\" Menon" <p@x.test>'
    );
  });

  it("encodes a non-ASCII display name rather than quoting it", () => {
    const out = formatAddress({ name: "प्रिया", email: "p@x.test" });
    expect(out).toMatch(/^=\?UTF-8\?B\?.+\?= <p@x\.test>$/);
  });
});

describe("quotedPrintable", () => {
  it("leaves plain text recognisable", () => {
    expect(quotedPrintable("Hello Priya")).toBe("Hello Priya");
  });

  it("encodes a rupee sign to its UTF-8 bytes", () => {
    // ₹ is E2 82 B9. Raw over a 7-bit relay this becomes "?".
    expect(quotedPrintable("₹")).toBe("=E2=82=B9");
  });

  it("escapes the equals sign, which is its own escape character", () => {
    expect(quotedPrintable("a=b")).toBe("a=3Db");
  });

  it("encodes trailing whitespace, which is stripped in transit otherwise", () => {
    expect(quotedPrintable("hello ")).toBe("hello=20");
  });

  it("wraps long lines with a soft break", () => {
    const out = quotedPrintable("x".repeat(200));
    for (const line of out.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    // A soft break is a trailing `=` and carries no content.
    expect(out).toContain("=\r\n");
  });

  it("normalises line endings to CRLF", () => {
    expect(quotedPrintable("a\nb")).toBe("a\r\nb");
    expect(quotedPrintable("a\r\nb")).toBe("a\r\nb");
  });
});

describe("dotStuff", () => {
  it("doubles a dot that begins a line", () => {
    // A lone "." on its own line ends the SMTP DATA command; unescaped, the
    // message is truncated exactly there.
    expect(dotStuff(".hidden")).toBe("..hidden");
    expect(dotStuff("ok\r\n.\r\nmore")).toBe("ok\r\n..\r\nmore");
  });

  it("leaves a dot mid-line alone", () => {
    expect(dotStuff("version 1.2")).toBe("version 1.2");
  });
});

describe("toCrlf", () => {
  it("normalises every line ending without doubling", () => {
    expect(toCrlf("a\nb\r\nc\rd")).toBe("a\r\nb\r\nc\r\nd");
  });
});

describe("messageId", () => {
  it("is angle-bracketed and unique", () => {
    const a = messageId("northbridge.example");
    expect(a).toMatch(/^<[a-f0-9]+\.\d+@northbridge\.example>$/);
    expect(a).not.toBe(messageId("northbridge.example"));
  });
});

describe("buildMessage", () => {
  const base = {
    from: { name: "Rahul Deshpande", email: "rahul@northbridge.example" },
    to: { name: "Priya Menon", email: "priya@vaitarna.example" },
    subject: "Quick question",
    text: "Hello Priya,\n\nAbout your NetSuite rollout.\n",
  };

  it("carries the headers a relay and a client both need", () => {
    const msg = buildMessage(base, { messageId: "<abc@x.test>", date: new Date(0) });
    for (const header of ["From:", "To:", "Subject:", "Date:", "Message-ID:", "MIME-Version: 1.0"]) {
      expect(msg).toContain(header);
    }
    expect(msg).toContain("Content-Transfer-Encoding: quoted-printable");
  });

  it("separates headers from the body with exactly one blank line", () => {
    const msg = buildMessage(base, { messageId: "<a@b.test>" });
    // Two CRLFs, not three — an extra one puts a blank line at the top of the
    // body, and a missing one makes the first body line look like a header.
    expect(msg).toContain("\r\n\r\n");
    const [headers] = msg.split("\r\n\r\n");
    expect(headers).not.toContain("Hello Priya");
  });

  it("is plain text when no HTML is given", () => {
    const msg = buildMessage(base, { messageId: "<a@b.test>" });
    expect(msg).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(msg).not.toContain("multipart/alternative");
  });

  it("is multipart when HTML is given, with the text part first", () => {
    const msg = buildMessage({ ...base, html: "<p>Hello</p>" }, { messageId: "<a@b.test>" });
    expect(msg).toContain("multipart/alternative");
    const boundary = /boundary="([^"]+)"/.exec(msg)![1];
    expect(msg).toContain(`--${boundary}--`);
    // Text before HTML: a client picks the last part it can render, and a
    // text-only client needs the first.
    expect(msg.indexOf("text/plain")).toBeLessThan(msg.indexOf("text/html"));
  });

  it("encodes a non-ASCII subject", () => {
    const msg = buildMessage({ ...base, subject: "₹18 lakh proposal" }, { messageId: "<a@b.test>" });
    expect(msg).toContain("Subject: =?UTF-8?B?");
  });

  it("carries a reply-to when one is set", () => {
    const msg = buildMessage(
      { ...base, replyTo: { email: "inbox@northbridge.example" } },
      { messageId: "<a@b.test>" }
    );
    expect(msg).toContain("Reply-To: inbox@northbridge.example");
  });

  it("uses CRLF throughout, since a bare LF is rejected by some relays", () => {
    const msg = buildMessage(base, { messageId: "<a@b.test>" });
    expect(/[^\r]\n/.test(msg)).toBe(false);
  });
});
