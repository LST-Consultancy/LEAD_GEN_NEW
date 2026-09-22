import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    const [notifications, unread] = await Promise.all([
      db.notification.findMany({
        where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.notification.count({
        where: { workspaceId: ctx.workspaceId, userId: ctx.userId, readAt: null },
      }),
    ]);

    return NextResponse.json({
      unread,
      notifications: notifications.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        severity: n.severity,
        href: n.href,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
