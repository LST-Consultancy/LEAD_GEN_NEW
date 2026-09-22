import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRevenueInMotion } from "@/lib/services/today";
import { handleApiError } from "@/lib/api/respond";
import { resolveCaller } from "@/lib/api/caller";

const schema = z.coerce.number().int().min(1).max(365);

export async function GET(req: NextRequest) {
  try {
    // Accepts a browser session or an API key holding "insights.read".
    const caller = await resolveCaller(req.headers, { scope: "insights.read" });
    if (!caller.ok) return caller.response;
    const ctx = caller.ctx;
    const days = schema.parse(req.nextUrl.searchParams.get("days") ?? 7);
    return NextResponse.json(await getRevenueInMotion(ctx, days));
  } catch (err) {
    return handleApiError(err);
  }
}
