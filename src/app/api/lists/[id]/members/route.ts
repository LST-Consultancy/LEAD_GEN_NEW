import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { addLeadsToList, removeLeadFromList } from "@/lib/services/lists";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const body = await req.json();
    return NextResponse.json(await addLeadsToList(ctx, (await params).id, body.leadIds));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const body = await req.json();
    return NextResponse.json(await removeLeadFromList(ctx, (await params).id, body.leadId));
  } catch (err) {
    return handleApiError(err);
  }
}
