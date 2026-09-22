import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { deleteNote, updateNote, updateNoteSchema } from "@/lib/services/notes";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That note reference isn't valid.", 400);
    const input = updateNoteSchema.parse(await req.json());
    return NextResponse.json(await updateNote(ctx, id, input));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That note reference isn't valid.", 400);
    return NextResponse.json(await deleteNote(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
