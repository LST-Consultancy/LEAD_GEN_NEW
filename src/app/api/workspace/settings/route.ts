import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { getWorkspaceSettings, updateWorkspaceSettings } from "@/lib/services/workspace-settings";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await getWorkspaceSettings(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await updateWorkspaceSettings(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
