import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { deletePlaybook, updatePlaybook } from "@/lib/services/playbooks";
import { handleApiError, unauthorized } from "@/lib/api/respond";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    return NextResponse.json(await updatePlaybook(ctx, id, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    return NextResponse.json(await deletePlaybook(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
