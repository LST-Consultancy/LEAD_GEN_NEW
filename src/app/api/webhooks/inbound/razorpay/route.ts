import { NextResponse, type NextRequest } from "next/server";
import { handleRazorpayWebhook } from "@/lib/services/billing";

/** Razorpay's server-to-server webhook. Authorised by its signature over the raw body, never by a session. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: { code: "too_large" } }, { status: 413 });
  const r = await handleRazorpayWebhook(raw, req.headers.get("x-razorpay-signature"), req.headers.get("x-razorpay-event-id"));
  return NextResponse.json({ outcome: r.outcome }, { status: r.status });
}
