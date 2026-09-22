import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import {
  deleteSearchPhrase,
  getPhraseRuns,
  updateSearchPhrase,
} from "@/lib/services/search-phrases";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That phrase reference isn't valid.", 400);
    }
    return NextResponse.json(await getPhraseRuns(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That phrase reference isn't valid.", 400);
    }
    return NextResponse.json(await updateSearchPhrase(ctx, id, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That phrase reference isn't valid.", 400);
    }
    return NextResponse.json(await deleteSearchPhrase(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
