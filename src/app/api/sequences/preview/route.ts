import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { previewStep } from "@/lib/services/sequences";
import { apiError, handleApiError, notFound, unauthorized } from "@/lib/api/respond";

const bodySchema = z.object({
  leadId: z.string().uuid().optional(),
  subject: z.string().max(300).optional(),
  bodyTemplate: z.string().min(1).max(20_000),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return apiError("invalid_request", "A preview needs at least a body template.", 400);
    }
    const preview = await previewStep(ctx, parsed.data);
    if (!preview) return notFound("That lead");
    return NextResponse.json(preview);
  } catch (err) {
    return handleApiError(err);
  }
}
