import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { startCheckout } from "@/lib/services/billing";
export async function POST(req: NextRequest) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await startCheckout(ctx, await req.json().catch(() => ({})))); } catch (error) { return handleApiError(error); }
}
