import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { setSequenceActive } from "@/lib/services/sequences";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();
const bodySchema = z.object({ isActive: z.boolean() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That sequence reference isn't valid.", 400);
    }
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return apiError("invalid_request", "Send isActive as a boolean.", 400);
    return NextResponse.json(await setSequenceActive(ctx, id, parsed.data.isActive));
  } catch (err) {
    return handleApiError(err);
  }
}
