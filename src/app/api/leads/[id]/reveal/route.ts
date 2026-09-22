import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { quoteReveal, revealContacts } from "@/lib/services/lead-mutations";
import { apiError, handleApiError, tooManyRequests } from "@/lib/api/respond";
import { rateLimit } from "@/lib/security/rate-limit";
import { resolveCaller } from "@/lib/api/caller";

const uuid = z.string().uuid();

const bodySchema = z.object({
  contactMethodIds: z.array(z.string().uuid()).max(20).optional(),
  /** Supply to make a retry safe — the same key never charges twice. */
  idempotencyKey: z.string().min(8).max(128).optional(),
});

/** What a reveal would cost, so the price is known before anything is charged. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Accepts a browser session or an API key holding "contacts.reveal".
    const caller = await resolveCaller(req.headers, { scope: "contacts.reveal" });
    if (!caller.ok) return caller.response;
    const ctx = caller.ctx;
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That lead reference isn't valid.", 400);
    return NextResponse.json(await quoteReveal(ctx, id));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Accepts a browser session or an API key holding "contacts.reveal".
    const caller = await resolveCaller(req.headers, { scope: "contacts.reveal" });
    if (!caller.ok) return caller.response;
    const ctx = caller.ctx;
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That lead reference isn't valid.", 400);

    const body = bodySchema.parse(await req.json().catch(() => ({})));

    // Per workspace, because that is whose points are spent. The ledger's
    // idempotency key already stops a *retry* charging twice; this stops a
    // loop of distinct reveals draining the balance before anyone notices.
    const limit = await rateLimit("spend", `ws:${ctx.workspaceId}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "reveals");

    return NextResponse.json(await revealContacts(ctx, id, body));
  } catch (err) {
    return handleApiError(err);
  }
}
