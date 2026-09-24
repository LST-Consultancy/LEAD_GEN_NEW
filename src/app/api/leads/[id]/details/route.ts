import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { updateLeadDetails } from "@/lib/services/lead-mutations";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

/** Corrects the person behind a lead: name, title, LinkedIn, city. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That lead reference isn't valid.", 400);
    return NextResponse.json(await updateLeadDetails(ctx, id, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
