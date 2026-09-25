import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { connectWhatsApp, disconnectWhatsApp, whatsappStatus } from "@/lib/services/whatsapp";
export async function GET() {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await whatsappStatus(ctx)); } catch (error) { return handleApiError(error); }
}
export async function POST(req: NextRequest) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await connectWhatsApp(ctx, await req.json())); } catch (error) { return handleApiError(error); }
}
export async function DELETE() {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await disconnectWhatsApp(ctx)); } catch (error) { return handleApiError(error); }
}
