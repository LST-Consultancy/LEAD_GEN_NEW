import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * §104 — time-based one-time passwords, RFC 6238.
 *
 * Implemented here rather than pulled in, for two reasons: it is forty lines of
 * arithmetic over `node:crypto`, and it is verifiable against the published
 * test vectors in the RFC — which the tests do. A dependency for this adds a
 * supply-chain surface to something that can be proven correct outright.
 *
 * Pure and stateless. Replay prevention needs to remember the last step a user
 * consumed, and that is the caller's job because it needs a database.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;

/** RFC 4648 base32, which is what every authenticator app expects. */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * A new shared secret.
 *
 * 20 bytes is the SHA-1 block-matched length RFC 4226 recommends, and what
 * every authenticator app is tested against. Shorter is weaker; longer is
 * silently truncated by some apps, which would break enrolment for those users
 * only — the worst kind of bug to ship.
 */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The `otpauth://` URI an authenticator app scans. */
export function provisioningUri(opts: {
  secret: string;
  accountName: string;
  issuer: string;
}): string {
  // The issuer appears twice by design: in the label for apps that only read
  // the label, and as a parameter for apps that read parameters.
  const label = encodeURIComponent(`${opts.issuer}:${opts.accountName}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The counter value for a moment in time. */
export function stepFor(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / STEP_SECONDS);
}

/** The code for one counter value. Exported so the tests can use RFC vectors. */
export function hotp(secret: Buffer, counter: number, digits: number = DIGITS): string {
  const buf = Buffer.alloc(8);
  // Counter is a 64-bit big-endian integer. Written as two 32-bit halves
  // because a JS number cannot hold the full range precisely.
  buf.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", secret).update(buf).digest();

  // Dynamic truncation, RFC 4226 §5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

export type VerifyResult =
  | { ok: true; step: number }
  | { ok: false; reason: "malformed" | "mismatch" | "replayed" };

/**
 * Checks a code.
 *
 * `window` is how many steps either side are accepted, for clock skew between
 * the phone and the server. One step — 30 seconds each way — is the usual
 * trade: wider makes a stolen code useful for longer.
 *
 * `lastUsedStep` is what makes a code single-use. Without it, a code shouted
 * over the shoulder stays valid for the rest of its window, which is most of
 * the reason to have a second factor at all.
 */
export function verifyTotp(opts: {
  secret: string;
  code: string;
  atMs?: number;
  window?: number;
  lastUsedStep?: number | null;
}): VerifyResult {
  const cleaned = opts.code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return { ok: false, reason: "malformed" };

  let key: Buffer;
  try {
    key = base32Decode(opts.secret);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (key.length === 0) return { ok: false, reason: "malformed" };

  const window = opts.window ?? 1;
  const current = stepFor(opts.atMs);

  for (let offset = -window; offset <= window; offset++) {
    const step = current + offset;
    if (step < 0) continue;
    if (!constantTimeEquals(hotp(key, step), cleaned)) continue;

    // The code is right. Reject it if this step, or an earlier one, has
    // already been spent — otherwise the same digits work twice.
    if (opts.lastUsedStep != null && step <= opts.lastUsedStep) {
      return { ok: false, reason: "replayed" };
    }
    return { ok: true, step };
  }

  return { ok: false, reason: "mismatch" };
}

/**
 * Recovery codes, for the phone that is lost or wiped.
 *
 * Returned in plaintext exactly once. Only their hashes are stored, for the
 * same reason a password is not stored: a database read must not hand someone
 * a way past the second factor.
 */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    // Base32 without padding, grouped, so it can be read aloud and typed.
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
}

/** Normalised so case and the dash do not decide whether a code works. */
export function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length — but both sides here are fixed-width digits, so a mismatch means
  // malformed input that was already rejected.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  // Padding and lower case are both common in what a user pastes back.
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
