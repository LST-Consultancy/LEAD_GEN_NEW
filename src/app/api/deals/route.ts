import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { getPipelineBoard } from "@/lib/services/pipeline";
import { createDeal, createDealSchema } from "@/lib/services/deal-mutations";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { resolveCaller } from "@/lib/api/caller";

export async function GET(req: NextRequest) {
  try {
    // Accepts a browser session or an API key holding "pipeline.read".
    const caller = await resolveCaller(req.headers, { scope: "pipeline.read" });
    if (!caller.ok) return caller.response;
    const ctx = caller.ctx;
    const pipelineId = req.nextUrl.searchParams.get("pipelineId") ?? undefined;
    const board = await getPipelineBoard(ctx, pipelineId);
    return NextResponse.json(board ?? { pipeline: null, columns: [], totals: null });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const input = createDealSchema.parse(await req.json());
    return NextResponse.json(await createDeal(ctx, input), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
