import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { deleteDeal, updateDeal, updateDealSchema } from "@/lib/services/deal-mutations";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That deal reference isn't valid.", 400);
    const input = updateDealSchema.parse(await req.json());
    if (Object.keys(input).length === 0) {
      return apiError("invalid_request", "Nothing to update.", 400);
    }
    return NextResponse.json(await updateDeal(ctx, id, input));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That deal reference isn't valid.", 400);
    return NextResponse.json(await deleteDeal(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
