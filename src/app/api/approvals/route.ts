import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { listApprovals, summariseApprovals } from "@/lib/services/trust";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const pending = await listApprovals(ctx);
    return NextResponse.json({ pending, summary: summariseApprovals(pending) });
  } catch (err) {
    return handleApiError(err);
  }
}
