import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { recordProposalDecision } from "@/lib/services/proposals";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That proposal reference isn't valid.", 400);
    }
    return NextResponse.json(await recordProposalDecision(ctx, id, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
