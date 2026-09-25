import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { recordWhatsAppOptIn, sendWhatsApp } from "@/lib/services/whatsapp";
/** POST { optIn: { number, evidence } } records consent; POST { idempotencyKey, message } sends. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext(); if (!ctx) return unauthorized();
    const body = await req.json() as { optIn?: unknown };
    const id = (await params).id;
    return NextResponse.json(body.optIn ? await recordWhatsAppOptIn(ctx, id, body.optIn) : await sendWhatsApp(ctx, id, body));
  } catch (error) { return handleApiError(error); }
}
