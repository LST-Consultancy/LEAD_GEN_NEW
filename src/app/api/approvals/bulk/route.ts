import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { approveAllPending } from "@/lib/services/agent-runner";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const bodySchema = z.object({ ids: z.array(z.string().uuid()).max(200).optional() });

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return apiError("invalid_request", "Send ids as a list of uuids.", 400);
    return NextResponse.json(await approveAllPending(ctx, parsed.data));
  } catch (err) {
    return handleApiError(err);
  }
}
