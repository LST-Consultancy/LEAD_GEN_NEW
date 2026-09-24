import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { startDealPlan } from "@/lib/services/deal-plans";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

/** Starts the deal's plan from the standard template. Returns the existing one if already started. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("invalid_request", "That deal reference isn't valid.", 400);
    return NextResponse.json(await startDealPlan(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
