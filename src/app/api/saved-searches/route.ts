import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { createSavedSearch, listSavedSearches } from "@/lib/services/lists";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await listSavedSearches(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await createSavedSearch(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
