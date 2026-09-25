import "server-only";
import { createPrivateKey, sign } from "node:crypto";

/**
 * Web Push without payloads (RFC 8030 delivery, RFC 8292 VAPID authentication).
 *
 * A push here is only a wake-up: the service worker then fetches the person's newest
 * notification from this app over their own session. That keeps the notification's text off the
 * push service entirely — so no RFC 8291 payload encryption is needed, and nothing readable is
 * handed to Google, Mozilla, Apple or Microsoft.
 *
 * Keys: VAPID_PUBLIC_KEY (65-byte uncompressed P-256 point) and VAPID_PRIVATE_KEY (32-byte
 * scalar), both base64url, and VAPID_SUBJECT (a mailto: or https: contact the push service can
 * use). Generate a pair once with `npx web-push generate-vapid-keys` or any P-256 tool.
 */
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? "";
export const pushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && /^(mailto:|https:\/\/)/.test(process.env.VAPID_SUBJECT ?? ""));

/** The push services browsers actually use. An endpoint elsewhere is refused, so a stored URL can never make this server call an arbitrary host. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
export function validPushEndpoint(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
    return PUSH_HOSTS.some(h => h.test(u.hostname)) ? u : null;
  } catch { return null; }
}

/** The VAPID JWT (ES256) for one push service origin. */
export function vapidAuthorization(endpoint: string, keys: { publicKey: string; privateKey: string; subject: string }, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const pub = Buffer.from(keys.publicKey, "base64url");
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY must be a 65-byte uncompressed P-256 point, base64url.");
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `vapid t=${unsigned}.${signature}, k=${keys.publicKey}`;
}

export type PushOutcome = { ok: true } | { ok: false; gone: boolean; retryable: boolean; reason: string };

/** One wake-up to one subscription. Never throws. */
export async function sendPush(endpoint: string, opts: { ttlSeconds?: number; urgency?: "normal" | "high"; timeoutMs?: number } = {}): Promise<PushOutcome> {
  const u = validPushEndpoint(endpoint);
  if (!u) return { ok: false, gone: true, retryable: false, reason: "Not a recognised browser push service; the subscription was dropped." };
  if (!pushConfigured()) return { ok: false, gone: false, retryable: true, reason: "Push is not configured on this server (VAPID keys)." };
  try {
    const res = await fetch(u, { method: "POST", redirect: "error", signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), headers: { TTL: String(opts.ttlSeconds ?? 3600), Urgency: opts.urgency ?? "normal", "Content-Length": "0", Authorization: vapidAuthorization(endpoint, { publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY!, subject: process.env.VAPID_SUBJECT! }) } });
    if (res.status === 201 || res.status === 200 || res.status === 202) return { ok: true };
    if (res.status === 404 || res.status === 410) return { ok: false, gone: true, retryable: false, reason: "The browser unsubscribed or the subscription expired." };
    if (res.status === 429 || res.status >= 500) return { ok: false, gone: false, retryable: true, reason: `The push service asked to try later (HTTP ${res.status}).` };
    return { ok: false, gone: false, retryable: false, reason: `The push service refused it (HTTP ${res.status}) — usually the VAPID keys do not match the ones the browser subscribed with.` };
  } catch {
    return { ok: false, gone: false, retryable: true, reason: "The push service could not be reached." };
  }
}
