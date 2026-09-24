import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { updateProfile } from "@/lib/services/account";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await updateProfile(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
