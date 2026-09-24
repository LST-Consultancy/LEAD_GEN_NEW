import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { provisionAgents } from "@/lib/services/autopilot";
import { handleApiError, unauthorized } from "@/lib/api/respond";

/** Adds any catalogue agent this workspace lacks, disabled. Safe to call twice. */
export async function POST() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await provisionAgents(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}
