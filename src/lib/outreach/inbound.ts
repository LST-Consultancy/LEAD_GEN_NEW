/**
 * Reading an inbound message well enough to act on it. Pure, so the hard cases are tested
 * directly. Three outcomes, because they need different actions:
 *  - `reply`: a person answered — stops a stop-on-reply sequence;
 *  - `auto_reply`: an out-of-office or autoresponder — recorded, never counts as a reply
 *    (RFC 3834 `Auto-Submitted`, plus the common vendor headers and subjects);
 *  - `bounce`: a delivery failure report — recorded against the message, not a reply.
 */
export type InboundKind = "reply" | "auto_reply" | "bounce";

/** Header lines unfolded (a line starting with whitespace continues the previous one), keys lower-cased. */
export function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = raw.replace(/\r\n[ \t]+/g, " ").split(/\r?\n/);
  for (const l of lines) {
    const i = l.indexOf(":");
    if (i <= 0) continue;
    const k = l.slice(0, i).trim().toLowerCase();
    if (!(k in out)) out[k] = decodeWords(l.slice(i + 1).trim());
  }
  return out;
}

/** RFC 2047 encoded words (=?utf-8?B?…?= and =?utf-8?Q?…?=) in headers such as Subject and From. */
export function decodeWords(v: string) {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _cs: string, enc: string, data: string) => {
    try {
      if (enc.toUpperCase() === "B") return Buffer.from(data, "base64").toString("utf8");
      return Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
    } catch { return data; }
  }).replace(/\?=\s+=\?/g, "");
}

export const addressOf = (v: string | undefined) => (v ? (/<([^>]+)>/.exec(v)?.[1] ?? v).trim().toLowerCase() : null);
/** Every Message-ID in a header, with its angle brackets, as they are stored when sending. */
export const messageIds = (v: string | undefined) => (v ? [...v.matchAll(/<[^<>\s]+>/g)].map(m => m[0]) : []);

export function classifyInbound(h: Record<string, string>): InboundKind {
  const from = addressOf(h.from) ?? "";
  if (/^(mailer-daemon|postmaster)@/i.test(from) || /report-type="?delivery-status/i.test(h["content-type"] ?? "") || (h["return-path"] ?? "").trim() === "<>") return "bounce";
  const auto = (h["auto-submitted"] ?? "no").toLowerCase();
  if (auto !== "no" || h["x-autoreply"] || h["x-autorespond"] || /^(auto_reply|bulk|junk|list)$/i.test(h.precedence ?? "")) return "auto_reply";
  if (/^(out of (the )?office|automatic reply|auto(-| )?reply|autoreply|on leave|away from)/i.test((h.subject ?? "").replace(/^(re|aw|fwd?):\s*/i, ""))) return "auto_reply";
  return "reply";
}

/**
 * The part of the body the person wrote, for the conversation view: the text/plain part of a
 * multipart message, quoted-printable soft breaks joined, and the quoted history below it cut.
 */
export function replyText(body: string, contentType = "") {
  let t = body;
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (boundary) {
    const parts = t.split(`--${boundary}`);
    const plain = parts.find(p => /content-type:\s*text\/plain/i.test(p));
    if (plain) { const sep = plain.search(/\r?\n\r?\n/); t = sep >= 0 ? plain.slice(sep).trim() : plain; if (/content-transfer-encoding:\s*quoted-printable/i.test(plain)) t = t.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))); }
  }
  const lines = t.split(/\r?\n/);
  const cut = lines.findIndex(l => /^>/.test(l) || /^On .{4,200}wrote:\s*$/.test(l) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^From: .+/.test(l));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").trim().slice(0, 4000);
}
