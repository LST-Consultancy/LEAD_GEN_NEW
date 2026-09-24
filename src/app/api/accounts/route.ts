import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { listAccounts } from "@/lib/services/people";
import { handleApiError, unauthorized } from "@/lib/api/respond";

/** Company search for pickers: id and name only, within the workspace. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) || undefined;
    const accounts = await listAccounts(ctx, { q, limit: 10 });
    return NextResponse.json({ accounts: accounts.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })) });
  } catch (err) {
    return handleApiError(err);
  }
}
