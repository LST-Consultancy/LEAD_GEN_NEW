import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { pushStatus, subscribePush, unsubscribePush } from "@/lib/services/push";
export async function GET() {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await pushStatus(ctx)); } catch (error) { return handleApiError(error); }
}
export async function POST(req: NextRequest) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await subscribePush(ctx, await req.json().catch(() => ({})))); } catch (error) { return handleApiError(error); }
}
export async function DELETE(req: NextRequest) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await unsubscribePush(ctx, await req.json().catch(() => ({})))); } catch (error) { return handleApiError(error); }
}
