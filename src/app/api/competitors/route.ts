import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { createCompetitor } from "@/lib/services/competitor-mutations";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await createCompetitor(ctx, await req.json()), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
