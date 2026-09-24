import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { revokeOtherSessions } from "@/lib/services/account";
import { handleApiError, unauthorized } from "@/lib/api/respond";

/** Signs out every session except this one. */
export async function DELETE() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await revokeOtherSessions(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}
