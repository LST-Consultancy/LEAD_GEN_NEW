import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { offeringSearchPlan } from "@/lib/services/offerings";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await offeringSearchPlan(ctx, (await params).id)); } catch (error) { return handleApiError(error); }
}
