import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { setNotificationMuted } from "@/lib/services/notification-settings";
import { handleApiError, unauthorized } from "@/lib/api/respond";

const schema = z.object({ kind: z.string().min(1).max(40), muted: z.boolean() });

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { kind, muted } = schema.parse(await req.json());
    return NextResponse.json(await setNotificationMuted(ctx, kind, muted));
  } catch (err) {
    return handleApiError(err);
  }
}
