import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { acceptInvitation } from "@/lib/services/team";
import { createSession, readSession, setActiveWorkspace } from "@/lib/auth/session";
import { handleApiError, tooManyRequests } from "@/lib/api/respond";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  token: z.string().min(20).max(100),
  name: z.string().optional(),
  password: z.string().optional(),
});

/**
 * Accepts an invitation. Public: the token in the link is the authorisation,
 * so guessing is bounded per source the same way public proposal links are.
 */
export async function POST(req: NextRequest) {
  try {
    const limit = await rateLimit("publicToken", `invite:${clientKey(req.headers)}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "attempts");
    const { token, ...rest } = schema.parse(await req.json());
    const session = await readSession();
    const outcome = await acceptInvitation(token, rest, session?.userId ?? null, { ipAddress: clientKey(req.headers) });
    if (!session || session.userId !== outcome.userId) {
      await createSession(outcome.userId, { userAgent: req.headers.get("user-agent") ?? undefined, workspaceId: outcome.workspaceId });
    }
    await setActiveWorkspace(outcome.workspaceId);
    return NextResponse.json({ ok: true, redirectTo: "/today" });
  } catch (err) {
    return handleApiError(err);
  }
}
