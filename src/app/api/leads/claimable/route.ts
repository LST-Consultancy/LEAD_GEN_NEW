import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { listClaimable } from "@/lib/services/lead-claims";
export async function GET() {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await listClaimable(ctx)); } catch (error) { return handleApiError(error); }
}
