import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { bulkAssign } from "@/lib/services/lead-bulk";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await bulkAssign(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
