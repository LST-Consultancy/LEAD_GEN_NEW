import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { getCashSummary } from "@/lib/services/deal-money";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await getCashSummary(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}
