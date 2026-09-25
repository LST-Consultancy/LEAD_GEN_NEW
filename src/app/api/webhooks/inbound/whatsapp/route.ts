import { NextResponse, type NextRequest } from "next/server";
import { handleWhatsAppWebhook, verifyWhatsAppWebhook } from "@/lib/services/whatsapp";

/**
 * Meta's WhatsApp webhook. No session: the verify token authorises the handshake and the
 * X-Hub-Signature-256 HMAC authorises each delivery. Bodies are read raw, because the signature is
 * over the exact bytes Meta sent.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const challenge = await verifyWhatsAppWebhook(q.get("hub.mode"), q.get("hub.verify_token"), q.get("hub.challenge"));
  return challenge ? new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } }) : NextResponse.json({ error: { code: "forbidden", message: "Unknown verify token." } }, { status: 403 });
}
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: { code: "too_large" } }, { status: 413 });
  const r = await handleWhatsAppWebhook(raw, req.headers.get("x-hub-signature-256"));
  return r.ok ? NextResponse.json({ received: true }) : NextResponse.json({ error: { code: r.status === 401 ? "bad_signature" : "bad_request" } }, { status: r.status });
}
