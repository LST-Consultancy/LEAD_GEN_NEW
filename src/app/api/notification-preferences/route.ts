import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { setNotificationEmail, setNotificationMuted } from "@/lib/services/notification-settings";
import { handleApiError, unauthorized } from "@/lib/api/respond";

const schema = z.union([z.object({ kind: z.string().min(1).max(40), muted: z.boolean() }), z.object({ kind: z.string().min(1).max(40), email: z.boolean() })]);

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const input = schema.parse(await req.json());
    return NextResponse.json("email" in input ? await setNotificationEmail(ctx, input.kind, input.email) : await setNotificationMuted(ctx, input.kind, input.muted));
  } catch (err) {
    return handleApiError(err);
  }
}
