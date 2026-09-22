import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext, assertPermission } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { moveDeal, DealMoveError } from "@/lib/services/pipeline";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const schema = z.object({
  toStageId: z.string().uuid(),
  sortOrder: z.number().int().min(0).optional(),
  lostReason: z.string().trim().min(3).max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    assertPermission(ctx, PERMISSIONS.PIPELINE_EDIT);

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return apiError("invalid_request", "That deal reference isn't valid.", 400);
    }

    const body = schema.parse(await req.json());
    const result = await moveDeal(ctx, { dealId: id, ...body });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DealMoveError) {
      return apiError("deal_move_failed", err.message, 409);
    }
    return handleApiError(err);
  }
}
