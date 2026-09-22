import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { listAgents } from "@/lib/services/autopilot";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await listAgents(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}
