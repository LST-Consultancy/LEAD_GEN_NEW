import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { listMembers } from "@/lib/services/members";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json({ members: await listMembers(ctx) });
  } catch (err) {
    return handleApiError(err);
  }
}
