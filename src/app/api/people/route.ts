import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { findPeople } from "@/lib/services/people";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await findPeople(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
