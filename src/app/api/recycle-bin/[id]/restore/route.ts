import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { restoreFromBin } from "@/lib/services/recycle-bin";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    return NextResponse.json(await restoreFromBin(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
