import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { sendProposal } from "@/lib/services/proposals";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();
const bodySchema = z.object({ byEmail: z.boolean().default(false) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That proposal reference isn't valid.", 400);
    }
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return apiError("invalid_request", "Send byEmail as a boolean.", 400);
    return NextResponse.json(await sendProposal(ctx, id, parsed.data));
  } catch (err) {
    return handleApiError(err);
  }
}
