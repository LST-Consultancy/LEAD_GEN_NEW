import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { changePassword } from "@/lib/services/account";
import { handleApiError, tooManyRequests, unauthorized } from "@/lib/api/respond";
import { rateLimit } from "@/lib/security/rate-limit";

/** Bounded like sign-in: a stolen session must not become unlimited password guesses. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const limit = await rateLimit("login", `password-change:${ctx.userId}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "password attempts");
    return NextResponse.json(await changePassword(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
