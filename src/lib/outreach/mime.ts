/**
 * §48 — building the bytes of an email.
 *
 * Pure, so the hard parts are tested directly rather than discovered in a
 * recipient's inbox. Each of them is a real way outbound mail goes wrong:
 *
 *  - **Non-ASCII in a header** must be RFC 2047 encoded. "Priya Menon" is fine;
 *    a Devanagari name or a ₹ in a subject is not, and an unencoded one either
 *    gets mangled or gets the message rejected.
 *  - **Non-ASCII in a body** needs a transfer encoding. Raw UTF-8 over a
 *    7-bit-only relay silently loses the high bit, which is how ₹ becomes ?.
 *  - **A line beginning with a dot** must be doubled, because a lone `.` on its
 *    own line is what ends the SMTP DATA command. Miss this and a message whose
 *    body happens to start a line with "." is truncated there.
 *  - **Lines end with CRLF**, not LF. Some relays accept bare LF; the ones that
 *    do not reject the whole message.
 */

export type EmailAddress = { name?: string; email: string };

export type OutgoingEmail = {
  from: EmailAddress;
  to: EmailAddress;
  replyTo?: EmailAddress;
  subject: string;
  /** Plain text. Required — a text part is what makes a message readable everywhere. */
  text: string;
  html?: string;
  headers?: Record<string, string>;
};

const CRLF = "\r\n";

/** True when every character is representable in 7-bit ASCII. */
export function isAscii(value: string): boolean {
  return /^[\x00-\x7F]*$/.test(value);
}

/**
 * RFC 2047 encoded-word, for header values that are not plain ASCII.
 *
 * Base64 rather than quoted-printable: for Indic scripts almost every byte
 * would need escaping, which makes quoted-printable longer *and* harder to
 * read in a raw dump.
 */
export function encodeHeaderValue(value: string): string {
  if (isAscii(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/** `Name <email>`, with the display name encoded and quoted when it needs it. */
export function formatAddress(addr: EmailAddress): string {
  if (!addr.name) return addr.email;
  const name = isAscii(addr.name)
    ? // A display name containing a comma, angle bracket or quote has to be
      // quoted or it splits the header into two addresses.
      /[",<>:;@\\]/.test(addr.name)
      ? `"${addr.name.replace(/(["\\])/g, "\\$1")}"`
      : addr.name
    : encodeHeaderValue(addr.name);
  return `${name} <${addr.email}>`;
}

/**
 * Quoted-printable, for a body that is not plain ASCII.
 *
 * Also used for ASCII bodies with very long lines: SMTP limits a line to 998
 * characters, and a wrapped paragraph can exceed it.
 */
export function quotedPrintable(input: string): string {
  const bytes = Buffer.from(input, "utf8");
  let out = "";
  let lineLength = 0;

  const push = (chunk: string) => {
    // Soft line break at 75, leaving room for the trailing `=`.
    if (lineLength + chunk.length > 75) {
      out += `=${CRLF}`;
      lineLength = 0;
    }
    out += chunk;
    lineLength += chunk.length;
  };

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];

    if (byte === 0x0d && bytes[i + 1] === 0x0a) {
      out += CRLF;
      lineLength = 0;
      i++;
      continue;
    }
    if (byte === 0x0a) {
      out += CRLF;
      lineLength = 0;
      continue;
    }

    const printable = byte >= 33 && byte <= 126 && byte !== 61; // 61 is '='
    const space = byte === 32 || byte === 9;

    if (printable) push(String.fromCharCode(byte));
    else if (space && !(bytes[i + 1] === 0x0d || bytes[i + 1] === 0x0a || i === bytes.length - 1)) {
      // Trailing whitespace is stripped in transit, so it is encoded instead.
      push(String.fromCharCode(byte));
    } else {
      push(`=${byte.toString(16).toUpperCase().padStart(2, "0")}`);
    }
  }

  return out;
}

/** Normalises to CRLF without doubling an existing one. */
export function toCrlf(input: string): string {
  return input.replace(/\r\n|\r|\n/g, CRLF);
}

/**
 * Doubles a leading dot on any line.
 *
 * Required before DATA: a line containing only `.` terminates the message, so
 * an unescaped one truncates it exactly there.
 */
export function dotStuff(input: string): string {
  return input.replace(/^\./gm, "..");
}

/** A Message-ID, which is what threading and bounce correlation key on. */
export function messageId(domain: string): string {
  const random = crypto.randomUUID().replace(/-/g, "");
  return `<${random}.${Date.now()}@${domain}>`;
}

/**
 * The full RFC 5322 message.
 *
 * Multipart when HTML is supplied, so a client that cannot render HTML still
 * has something to show — and so the message does not look like the
 * HTML-only blasts that spam filters score down.
 */
export function buildMessage(email: OutgoingEmail, opts: { messageId: string; date?: Date }): string {
  const domain = email.from.email.split("@")[1] ?? "localhost";
  void domain;

  const headers: string[] = [
    `From: ${formatAddress(email.from)}`,
    `To: ${formatAddress(email.to)}`,
    `Subject: ${encodeHeaderValue(email.subject)}`,
    `Date: ${(opts.date ?? new Date()).toUTCString()}`,
    `Message-ID: ${opts.messageId}`,
    "MIME-Version: 1.0",
  ];

  if (email.replyTo) headers.push(`Reply-To: ${formatAddress(email.replyTo)}`);
  for (const [key, value] of Object.entries(email.headers ?? {})) {
    headers.push(`${key}: ${encodeHeaderValue(value)}`);
  }

  const textEncoded = quotedPrintable(toCrlf(email.text));

  if (!email.html) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: quoted-printable");
    return `${headers.join(CRLF)}${CRLF}${CRLF}${textEncoded}`;
  }

  const boundary = `sr_${crypto.randomUUID().replace(/-/g, "")}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    textEncoded,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    quotedPrintable(toCrlf(email.html)),
    "",
    `--${boundary}--`,
  ];

  return `${headers.join(CRLF)}${CRLF}${CRLF}${parts.join(CRLF)}`;
}

/**
 * Threading headers for a message that continues a conversation (RFC 5322 §3.6.4): `In-Reply-To`
 * is the message being answered, `References` the chain, oldest first. Without them a follow-up
 * or a reply lands as a new thread in the recipient's client, and their answer may not reference
 * anything this app sent. `References` keeps the first and the most recent ids when the chain is
 * long, as the RFC suggests, and stays inside the 998-character line limit.
 */
export function threadHeaders(chain: string[]): Record<string, string> {
  const ids = [...new Set(chain.map(id => id.trim()).filter(id => /^<[^<>\s]+@[^<>\s]+>$/.test(id)))];
  if (!ids.length) return {};
  let refs = ids.length > 10 ? [ids[0], ...ids.slice(-9)] : ids;
  while (refs.join(" ").length > 900 && refs.length > 2) refs = [refs[0], ...refs.slice(2)];
  return { "In-Reply-To": ids[ids.length - 1], References: refs.join(" ") };
}
