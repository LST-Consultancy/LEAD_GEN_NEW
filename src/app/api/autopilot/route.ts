import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { getAutopilotConfig, updateAutopilotConfig } from "@/lib/services/autopilot";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await getAutopilotConfig(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await updateAutopilotConfig(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
