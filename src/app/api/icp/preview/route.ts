import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { previewIcpMatch } from "@/lib/services/icp";
import { handleApiError, unauthorized } from "@/lib/api/respond";

/** Read-only: counts what a candidate definition would match right now. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await previewIcpMatch(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
