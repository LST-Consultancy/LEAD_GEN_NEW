import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { queueOpportunityAction } from "@/lib/services/opportunity-jobs";
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await queueOpportunityAction(ctx, (await params).id, "research")); } catch (error) { return handleApiError(error); }
}
