import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { assignableRoles, createInvitation, invitationLink, listInvitations } from "@/lib/services/team";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const [invitations, roles] = await Promise.all([listInvitations(ctx), assignableRoles(ctx)]);
    return NextResponse.json({ invitations, roles });
  } catch (err) {
    return handleApiError(err);
  }
}

/** The link is in this response only. It is not emailed: no mail is sent from here. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { token, ...inv } = await createInvitation(ctx, await req.json());
    return NextResponse.json({ ...inv, link: invitationLink(req.nextUrl.origin, token) });
  } catch (err) {
    return handleApiError(err);
  }
}
