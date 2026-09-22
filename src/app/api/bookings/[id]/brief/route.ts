import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { getBookingBrief } from "@/lib/services/bookings";
import { apiError, handleApiError, notFound, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That meeting reference isn't valid.", 400);
    }
    const brief = await getBookingBrief(ctx, id);
    if (!brief) return notFound("That meeting");
    return NextResponse.json(brief);
  } catch (err) {
    return handleApiError(err);
  }
}
