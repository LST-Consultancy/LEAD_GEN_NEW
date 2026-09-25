import "server-only";
import net from "node:net";
import tls from "node:tls";

/**
 * IMAP, spoken directly — only the part reading replies needs (RFC 9051 / 3501): LOGIN, SELECT,
 * UID SEARCH, UID FETCH of headers and the start of the body, LOGOUT. No dependency, for the same
 * reason as the SMTP adapter. Tested against a scripted server in `tests/mailboxes.test.ts`.
 *
 * The parts that matter:
 *  - **Literals.** A value can arrive as `{123}` followed by exactly 123 bytes on the next line;
 *    reading line by line without honouring that truncates headers mid-way.
 *  - **`UID n:*` always matches the newest message**, even when its UID is below n, so results are
 *    filtered to UIDs above the last one read — otherwise the newest reply is re-read every poll.
 *  - **TLS only.** Plain IMAP sends the password in clear, so it is refused except to localhost.
 */

export type ImapConfig = { host: string; port: number; secure: boolean; user: string; pass: string; folder?: string; timeoutMs?: number };
export type FetchedMessage = { uid: number; headers: string; text: string };
export class ImapError extends Error { constructor(message: string, readonly kind: "auth" | "connection" | "protocol" | "timeout" | "insecure") { super(message); } }

type Response = { text: string; literals: Buffer[] };

class Connection {
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  private closed: Error | null = null;
  private tagN = 0;
  constructor(private socket: net.Socket, timeoutMs: number) {
    socket.setTimeout(timeoutMs);
    socket.on("data", (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); this.wake(); });
    socket.on("timeout", () => { this.fail(new ImapError("The mail server stopped answering.", "timeout")); socket.destroy(); });
    socket.on("error", e => this.fail(new ImapError(`Connection failed: ${e.message}`, "connection")));
    socket.on("close", () => this.fail(new ImapError("The mail server closed the connection.", "connection")));
  }
  private fail(e: Error) { if (!this.closed) this.closed = e; this.wake(); }
  private wake() { const w = this.waiters; this.waiters = []; w.forEach(f => f()); }
  private async need(n: number) { while (this.buf.length < n) { if (this.closed) throw this.closed; await new Promise<void>(r => this.waiters.push(r)); } }
  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf("\r\n");
      if (i >= 0) { const l = this.buf.subarray(0, i).toString("utf8"); this.buf = this.buf.subarray(i + 2); return l; }
      if (this.closed) throw this.closed;
      await new Promise<void>(r => this.waiters.push(r));
    }
  }
  /** One complete server response, with every literal read in full. */
  async response(): Promise<Response> {
    let text = ""; const literals: Buffer[] = [];
    for (;;) {
      const l = await this.line();
      const m = /\{(\d+)\}$/.exec(l);
      if (!m) { text += l; return { text, literals }; }
      const n = Number(m[1]);
      await this.need(n);
      literals.push(Buffer.from(this.buf.subarray(0, n)));
      this.buf = this.buf.subarray(n);
      text += `${l.slice(0, m.index)}\u0000${literals.length - 1}\u0000`;
    }
  }
  async command(cmd: string): Promise<Response[]> {
    const tag = `S${++this.tagN}`;
    this.socket.write(`${tag} ${cmd}\r\n`);
    const untagged: Response[] = [];
    for (;;) {
      const r = await this.response();
      if (r.text.startsWith(`${tag} `)) {
        const status = r.text.slice(tag.length + 1);
        if (status.startsWith("OK")) return untagged;
        throw new ImapError(`${cmd.split(" ")[0]} was refused: ${status.replace(/^(NO|BAD)\s*/, "")}`, cmd.startsWith("LOGIN") ? "auth" : "protocol");
      }
      untagged.push(r);
    }
  }
  end() { this.socket.end(); }
}

/** An IMAP quoted string; a credential with a line break is refused rather than sent. */
export function quote(v: string) {
  if (/[\r\n\0]/.test(v)) throw new ImapError("The value contains a line break, which IMAP cannot carry.", "protocol");
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
async function open(c: ImapConfig): Promise<Connection> {
  if (!c.secure && !LOCAL.has(c.host)) throw new ImapError("Plain IMAP would send the password unencrypted. Use the server's TLS port (usually 993).", "insecure");
  const timeoutMs = c.timeoutMs ?? 20_000;
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = c.secure ? tls.connect({ host: c.host, port: c.port, servername: c.host }, () => resolve(s)) : net.connect({ host: c.host, port: c.port }, () => resolve(s));
    s.once("error", e => reject(new ImapError(`Could not connect to ${c.host}:${c.port}: ${e.message}`, "connection")));
    s.setTimeout(timeoutMs, () => { s.destroy(); reject(new ImapError(`No answer from ${c.host}:${c.port}.`, "timeout")); });
  });
  const conn = new Connection(socket, timeoutMs);
  const greeting = await conn.response();
  if (!/^\* (OK|PREAUTH)/.test(greeting.text)) { conn.end(); throw new ImapError("The server did not greet as an IMAP server.", "protocol"); }
  return conn;
}

/** Logs in and selects the folder; returns its UIDVALIDITY and the highest UID. Nothing is read or changed. */
export async function checkMailbox(c: ImapConfig) {
  const conn = await open(c);
  try {
    await conn.command(`LOGIN ${quote(c.user)} ${quote(c.pass)}`);
    const sel = await conn.command(`EXAMINE ${quote(c.folder ?? "INBOX")}`);
    return { uidValidity: uidValidityOf(sel), exists: existsOf(sel), uidNext: uidNextOf(sel) };
  } finally { await conn.command("LOGOUT").catch(() => null); conn.end(); }
}

const uidValidityOf = (rs: Response[]) => rs.map(r => /\[UIDVALIDITY (\d+)\]/.exec(r.text)?.[1]).find(Boolean) ?? null;
const existsOf = (rs: Response[]) => Number(rs.map(r => /^\* (\d+) EXISTS/.exec(r.text)?.[1]).find(Boolean) ?? 0);
const uidNextOf = (rs: Response[]) => { const v = rs.map(r => /\[UIDNEXT (\d+)\]/.exec(r.text)?.[1]).find(Boolean); return v ? Number(v) : null; };

const HEADER_FIELDS = "FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES AUTO-SUBMITTED X-AUTOREPLY X-AUTORESPOND PRECEDENCE RETURN-PATH CONTENT-TYPE";

/**
 * New messages since `afterUid`, oldest first, at most `limit`. Read-only: EXAMINE and
 * BODY.PEEK leave every message's \Seen flag as it was, so the person's inbox is not changed.
 */
export async function fetchSince(c: ImapConfig, afterUid: number, limit = 50): Promise<{ uidValidity: string | null; messages: FetchedMessage[]; highestUid: number }> {
  const conn = await open(c);
  try {
    await conn.command(`LOGIN ${quote(c.user)} ${quote(c.pass)}`);
    const sel = await conn.command(`EXAMINE ${quote(c.folder ?? "INBOX")}`);
    const uidValidity = uidValidityOf(sel);
    const found = await conn.command(`UID SEARCH UID ${afterUid + 1}:*`);
    const uids = found.flatMap(r => (r.text.startsWith("* SEARCH") ? r.text.slice(8).trim().split(/\s+/).filter(Boolean).map(Number) : [])).filter(u => u > afterUid).sort((a, b) => a - b).slice(0, limit);
    if (!uids.length) return { uidValidity, messages: [], highestUid: afterUid };
    const rows = await conn.command(`UID FETCH ${uids.join(",")} (UID BODY.PEEK[HEADER.FIELDS (${HEADER_FIELDS})] BODY.PEEK[TEXT]<0.8192>)`);
    const messages: FetchedMessage[] = [];
    for (const r of rows) {
      if (!/^\* \d+ FETCH/.test(r.text)) continue;
      const uid = Number(/UID (\d+)/.exec(r.text)?.[1] ?? 0);
      if (!uid) continue;
      // Each literal follows the item it belongs to; find which by the text just before its marker.
      let headers = ""; let text = "";
      r.text.replace(/(BODY\[[^\]]*\](?:<\d+>)?)\s*\u0000(\d+)\u0000/g, (_m, item: string, idx: string) => {
        const value = r.literals[Number(idx)]?.toString("utf8") ?? "";
        if (item.startsWith("BODY[HEADER")) headers = value; else if (item.startsWith("BODY[TEXT]")) text = value;
        return "";
      });
      messages.push({ uid, headers, text });
    }
    return { uidValidity, messages: messages.sort((a, b) => a.uid - b.uid), highestUid: Math.max(afterUid, ...uids) };
  } finally { await conn.command("LOGOUT").catch(() => null); conn.end(); }
}
