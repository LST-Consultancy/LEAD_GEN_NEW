import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { createSupportRequest, listSupportRequests } from "@/lib/services/support-requests";
import { handleApiError, tooManyRequests, unauthorized } from "@/lib/api/respond";
import { rateLimit } from "@/lib/security/rate-limit";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json({ requests: await listSupportRequests(ctx) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const limit = await rateLimit("write", `support:${ctx.userId}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "requests");
    return NextResponse.json(await createSupportRequest(ctx, await req.json()), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
