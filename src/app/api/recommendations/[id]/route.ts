import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { decideRecommendation } from "@/lib/services/lead-activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await decideRecommendation(ctx, (await params).id, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
