import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { savePlanAsTemplate } from "@/lib/services/deal-plans";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

/** Saves this deal's plan as a workspace template (a new version if the name exists). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("invalid_request", "That deal reference isn't valid.", 400);
    const { name } = z.object({ name: z.string() }).parse(await req.json());
    return NextResponse.json(await savePlanAsTemplate(ctx, id, name), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
