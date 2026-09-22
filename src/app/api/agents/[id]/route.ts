import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { getAgentDetail } from "@/lib/services/trust";
import { apiError, handleApiError, notFound, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That agent reference isn't valid.", 400);
    }
    const detail = await getAgentDetail(ctx, id);
    if (!detail) return notFound("That agent");
    return NextResponse.json(detail);
  } catch (err) {
    return handleApiError(err);
  }
}
