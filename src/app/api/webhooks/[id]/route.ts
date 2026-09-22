import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { deleteWebhook, setWebhookActive } from "@/lib/services/webhooks";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();
const patchSchema = z.object({ isActive: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That webhook reference isn't valid.", 400);
    }
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) return apiError("invalid_request", "Send isActive as a boolean.", 400);
    return NextResponse.json(await setWebhookActive(ctx, id, parsed.data.isActive));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That webhook reference isn't valid.", 400);
    }
    return NextResponse.json(await deleteWebhook(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
