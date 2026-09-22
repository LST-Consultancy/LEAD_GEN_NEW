import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { createNote } from "@/lib/services/notes";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const bodySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  isPinned: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return apiError("invalid_request", "That lead reference isn't valid.", 400);
    }
    const input = bodySchema.parse(await req.json());
    return NextResponse.json(await createNote(ctx, { ...input, leadId: id }), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
