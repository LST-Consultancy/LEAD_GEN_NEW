import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { deleteProposal, getProposal, updateProposal } from "@/lib/services/proposals";
import { apiError, handleApiError, notFound, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That proposal reference isn't valid.", 400);
    }
    const proposal = await getProposal(ctx, id);
    if (!proposal) return notFound("That proposal");
    return NextResponse.json(proposal);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That proposal reference isn't valid.", 400);
    }
    return NextResponse.json(await updateProposal(ctx, id, await req.json()));
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
      return apiError("invalid_request", "That proposal reference isn't valid.", 400);
    }
    return NextResponse.json(await deleteProposal(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
