import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { deleteTask, updateTask, updateTaskSchema } from "@/lib/services/tasks";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That task reference isn't valid.", 400);
    const input = updateTaskSchema.parse(await req.json());
    if (Object.keys(input).length === 0) {
      return apiError("invalid_request", "Nothing to update.", 400);
    }
    return NextResponse.json(await updateTask(ctx, id, input));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That task reference isn't valid.", 400);
    return NextResponse.json(await deleteTask(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
