import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { assignableRoles, createInvitation, emailInvitation, invitationLink, listInvitations } from "@/lib/services/team";
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

/** The link is in this response only. It is emailed too when `sendEmail` is true and a mail provider works. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const body = (await req.json()) as { sendEmail?: boolean } & Record<string, unknown>;
    const { token, ...inv } = await createInvitation(ctx, body as never);
    const link = invitationLink(req.nextUrl.origin, token);
    const delivery = body.sendEmail === true ? await emailInvitation(ctx, inv.id, link) : { emailed: false, note: null };
    return NextResponse.json({ ...inv, link, ...delivery });
  } catch (err) {
    return handleApiError(err);
  }
}
