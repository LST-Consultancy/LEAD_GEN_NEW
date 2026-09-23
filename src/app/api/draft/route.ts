import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { draftOutreach } from "@/lib/services/draft";
import { apiError, handleApiError, tooManyRequests, unauthorized } from "@/lib/api/respond";
import { rateLimit } from "@/lib/security/rate-limit";

/**
 * Drafting only. Nothing here sends, queues or marks a lead contacted — the
 * response is text for a person to read and decide on.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    // A model call, so it is priced and slow. Per workspace, because that is
    // whose bill it lands on.
    const limit = await rateLimit("ai", `ws:${ctx.workspaceId}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "drafts");

    const result = await draftOutreach(ctx, await req.json());

    if (!result.ok) {
      // A refusal to draft is a considered outcome, not a server fault, so it
      // carries its own code and the sentence the service wrote.
      const status = result.code === "lead_not_found" ? 404 : 422;
      return apiError(result.code, result.reason, status);
    }

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
