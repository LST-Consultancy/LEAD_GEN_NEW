import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { listOpportunities } from "@/lib/services/opportunities";
export async function GET(req: NextRequest) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await listOpportunities(ctx, Object.fromEntries(req.nextUrl.searchParams))); } catch (error) { return handleApiError(error); }
}
