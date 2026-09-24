import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { logTouch } from "@/lib/services/lead-activity";

/** Records a touch that happened outside the product. Sends nothing. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await logTouch(ctx, (await params).id, await req.json()), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
