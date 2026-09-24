import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { movePlanStep } from "@/lib/services/deal-plans";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const body = z.object({ direction: z.enum(["up", "down"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("invalid_request", "That step reference isn't valid.", 400);
    return NextResponse.json(await movePlanStep(ctx, id, body.parse(await req.json()).direction));
  } catch (err) {
    return handleApiError(err);
  }
}
