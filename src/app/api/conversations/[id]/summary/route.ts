import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { summariseThread } from "@/lib/ai/summarise";
import { apiError, handleApiError, tooManyRequests, unauthorized } from "@/lib/api/respond";
import { rateLimit } from "@/lib/security/rate-limit";
import { z } from "zod";

const uuid = z.string().uuid();

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    const limit = await rateLimit("ai", `ws:${ctx.workspaceId}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "summaries");

    const { id } = await params;
    // A malformed id is a bad request, not a server fault: without this
    // Prisma throws on the uuid column and the caller gets a 500.
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That conversation reference isn't valid.", 400);
    }
    const result = await summariseThread(ctx, id);

    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 422;
      return apiError(result.code, result.reason, status);
    }
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
