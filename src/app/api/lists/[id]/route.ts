import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { deleteList } from "@/lib/services/lists";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That list reference isn't valid.", 400);
    }
    return NextResponse.json(await deleteList(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
