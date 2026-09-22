import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { createBooking, listBookings } from "@/lib/services/bookings";
import { handleApiError, unauthorized } from "@/lib/api/respond";

const windowSchema = z.enum(["upcoming", "past", "all"]).catch("upcoming");

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    // Parsed tolerantly: a stale link should not 400.
    const window = windowSchema.parse(new URL(req.url).searchParams.get("window"));
    return NextResponse.json(await listBookings(ctx, { window }));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await createBooking(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
