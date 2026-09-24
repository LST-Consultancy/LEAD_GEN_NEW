import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { invitationLink, resendInvitation, revokeInvitation } from "@/lib/services/team";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

/** Resend: a fresh link and expiry. The previous link stops working. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That invitation reference isn't valid.", 400);
    const { token, ...inv } = await resendInvitation(ctx, id);
    return NextResponse.json({ ...inv, link: invitationLink(req.nextUrl.origin, token) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That invitation reference isn't valid.", 400);
    return NextResponse.json(await revokeInvitation(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}
