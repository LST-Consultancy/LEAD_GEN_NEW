import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { createOffering, listOfferings } from "@/lib/services/offerings";
export async function GET() {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await listOfferings(ctx)); } catch (error) { return handleApiError(error); }
}
export async function POST(req: NextRequest) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await createOffering(ctx, await req.json())); } catch (error) { return handleApiError(error); }
}
