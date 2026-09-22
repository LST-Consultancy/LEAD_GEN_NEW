import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function POST() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    const result = await db.notification.updateMany({
      where: { workspaceId: ctx.workspaceId, userId: ctx.userId, readAt: null },
      data: { readAt: new Date() },
    });

    return NextResponse.json({ ok: true, marked: result.count });
  } catch (err) {
    return handleApiError(err);
  }
}
