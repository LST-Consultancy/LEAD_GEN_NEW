import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { listOpportunityProviders } from "@/lib/services/opportunity-providers";
export async function GET() {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await listOpportunityProviders(ctx)); } catch (error) { return handleApiError(error); }
}
