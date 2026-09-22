import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { getConversation } from "@/lib/services/inbox";
import {
  assignConversation,
  setConversationRead,
  setConversationState,
} from "@/lib/services/inbox-mutations";
import { apiError, handleApiError, notFound, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

const patchSchema = z.union([
  z.object({ state: z.enum(["OPEN", "NEEDS_YOU", "WAITING", "SNOOZED", "CLOSED"]), snoozedUntil: z.string().optional() }),
  z.object({ isUnread: z.boolean() }),
  z.object({ assigneeId: z.string().uuid().nullable() }),
]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That conversation reference isn't valid.", 400);
    }
    const conversation = await getConversation(ctx, id);
    if (!conversation) return notFound("That conversation");
    return NextResponse.json(conversation);
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
      return apiError("invalid_request", "That conversation reference isn't valid.", 400);
    }

    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return apiError(
        "invalid_request",
        "Send exactly one of state, isUnread or assigneeId.",
        400
      );
    }
    const body = parsed.data;

    if ("state" in body) {
      return NextResponse.json(
        await setConversationState(ctx, id, {
          state: body.state,
          snoozedUntil: body.snoozedUntil ? new Date(body.snoozedUntil) : undefined,
        })
      );
    }
    if ("isUnread" in body) {
      return NextResponse.json(await setConversationRead(ctx, id, body.isUnread));
    }
    return NextResponse.json(await assignConversation(ctx, id, body.assigneeId));
  } catch (err) {
    return handleApiError(err);
  }
}
