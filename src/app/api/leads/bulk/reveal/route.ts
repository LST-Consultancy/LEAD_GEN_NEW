import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { bulkReveal, quoteBulkReveal } from "@/lib/services/lead-bulk";

/** The price before any charge: how many locked contacts the selection would unlock. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean);
    return NextResponse.json(await quoteBulkReveal(ctx, ids));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await bulkReveal(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
