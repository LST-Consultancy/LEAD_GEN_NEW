import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { dryRunAgent } from "@/lib/services/autopilot";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

/** Read-only: evaluates the guardrails and writes nothing. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That agent reference isn't valid.", 400);
    }
    return NextResponse.json(await dryRunAgent(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
