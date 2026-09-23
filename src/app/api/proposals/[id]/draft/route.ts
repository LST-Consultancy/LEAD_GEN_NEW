import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { draftProposalNarrative } from "@/lib/proposals/draft";
import { apiError, handleApiError, tooManyRequests, unauthorized } from "@/lib/api/respond";
import { rateLimit } from "@/lib/security/rate-limit";

const uuid = z.string().uuid();

/**
 * Drafts the narrative sections only. Line items, tax and totals are untouched
 * — they are arithmetic over rows, not something a model should produce.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    const limit = await rateLimit("ai", `ws:${ctx.workspaceId}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "drafts");

    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That proposal reference isn't valid.", 400);
    }

    const body = await req.json().catch(() => ({}));
    const result = await draftProposalNarrative(ctx, { ...body, proposalId: id });

    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 422;
      return apiError(result.code, result.reason, status);
    }
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
