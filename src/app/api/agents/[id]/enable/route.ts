import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { setAgentEnabled } from "@/lib/services/autopilot";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();
const bodySchema = z.object({ isEnabled: z.boolean() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That agent reference isn't valid.", 400);
    }
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return apiError("invalid_request", "Send isEnabled as a boolean.", 400);
    return NextResponse.json(await setAgentEnabled(ctx, id, parsed.data.isEnabled));
  } catch (err) {
    return handleApiError(err);
  }
}
