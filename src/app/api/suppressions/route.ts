import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { suppressAddress } from "@/lib/services/inbox-mutations";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await suppressAddress(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
