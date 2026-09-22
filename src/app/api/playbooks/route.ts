import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { createPlaybook, listPlaybooks } from "@/lib/services/playbooks";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await listPlaybooks(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await createPlaybook(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
