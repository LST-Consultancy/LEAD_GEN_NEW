import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { decideOnAgentAction } from "@/lib/services/autopilot";
import { approveAndRun } from "@/lib/services/agent-runner";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That action reference isn't valid.", 400);
    }
    const body = await req.json();
    // Approving executes it: the person said yes to a specific action, and
    // leaving it queued for a pass that never comes would look done without
    // being done. Rejecting is only a decision, so it stays a decision.
    if (body?.decision === "approve") {
      return NextResponse.json(await approveAndRun(ctx, id));
    }
    return NextResponse.json(await decideOnAgentAction(ctx, id, body));
  } catch (err) {
    return handleApiError(err);
  }
}
