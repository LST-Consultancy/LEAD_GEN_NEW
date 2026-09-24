import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { revokeSession } from "@/lib/services/account";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("invalid_request", "That session reference isn't valid.", 400);
    return NextResponse.json(await revokeSession(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
