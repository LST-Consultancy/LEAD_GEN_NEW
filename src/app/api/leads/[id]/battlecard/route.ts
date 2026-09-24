import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { getBattlecard } from "@/lib/services/battlecard";
import { apiError, handleApiError, notFound, unauthorized } from "@/lib/api/respond";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("invalid_request", "That lead reference isn't valid.", 400);
    const card = await getBattlecard(ctx, id);
    if (!card) return notFound("That lead");
    return NextResponse.json(card);
  } catch (err) {
    return handleApiError(err);
  }
}
