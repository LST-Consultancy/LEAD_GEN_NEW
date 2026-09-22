import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/auth/context";
import { setActiveWorkspace } from "@/lib/auth/session";
import { handleApiError, notFound, unauthorized } from "@/lib/api/respond";

const schema = z.object({ workspaceId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    const { workspaceId } = schema.parse(await req.json());

    // Membership check, not a UI check — switching is a tenant boundary.
    const membership = await db.workspaceMember.findFirst({
      where: { workspaceId, userId: ctx.userId, deletedAt: null, workspace: { deletedAt: null } },
    });
    if (!membership) return notFound("That workspace");

    await setActiveWorkspace(workspaceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
