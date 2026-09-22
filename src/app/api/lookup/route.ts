import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { lookUp } from "@/lib/services/people";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const schema = z.object({ q: z.string().trim().min(1).max(200) });

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return apiError("invalid_request", "Send a query.", 400);
    return NextResponse.json(await lookUp(ctx, parsed.data.q));
  } catch (err) {
    return handleApiError(err);
  }
}
