import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { cancelBooking, rescheduleBooking } from "@/lib/services/bookings";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();
const cancelSchema = z.object({ reason: z.string().trim().min(3) });

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That meeting reference isn't valid.", 400);
    }
    const parsed = cancelSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError("invalid_request", "Cancelling needs a reason.", 400);
    }
    return NextResponse.json(await cancelBooking(ctx, id, parsed.data.reason));
  } catch (err) {
    return handleApiError(err);
  }
}

/** Reschedule: new start and end, optionally a reason kept on the record. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That meeting reference isn't valid.", 400);
    }
    return NextResponse.json(await rescheduleBooking(ctx, id, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
