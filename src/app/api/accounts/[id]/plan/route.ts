import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { generateAccountPlan } from "@/lib/ai/account-plan";
import { apiError, handleApiError, tooManyRequests, unauthorized } from "@/lib/api/respond";
import { rateLimit } from "@/lib/security/rate-limit";

const uuid = z.string().uuid();

/**
 * Generates an account strategy briefing on demand. Not persisted — the
 * committee, deals and signals it is grounded in already live in their own
 * tables, so a person can regenerate it rather than the app storing a copy
 * that drifts from them.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    const limit = await rateLimit("ai", `ws:${ctx.workspaceId}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "plans");

    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That account reference isn't valid.", 400);
    }

    const result = await generateAccountPlan(ctx, { companyId: id });

    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 422;
      return apiError(result.code, result.reason, status);
    }
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
