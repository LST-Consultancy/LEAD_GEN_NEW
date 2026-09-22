import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { recordProposalView } from "@/lib/services/proposal-public";
import { handleApiError, tooManyRequests } from "@/lib/api/respond";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { db } from "@/lib/db";

/**
 * Unauthenticated: the token is the authorisation.
 *
 * It still reads the session, for one reason only — to find out whether the
 * reader is on the owning team, so the seller refreshing their own proposal
 * does not inflate the view count they will later read as buyer interest.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;

    // Same reasoning as the decide route: unauthenticated, token in a URL, so
    // the limit is keyed on the source rather than on the token being tried.
    const limit = await rateLimit("publicToken", `ip:${clientKey(req.headers)}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "attempts");

    const ctx = await getAuthContext();

    let isOwnTeam = false;
    if (ctx) {
      const owned = await db.proposal.findFirst({
        where: { publicToken: token, workspaceId: ctx.workspaceId },
        select: { id: true },
      });
      isOwnTeam = owned !== null;
    }

    const result = await recordProposalView(token, {
      // Behind a proxy this is the client address; locally it is absent, and
      // absent is handled rather than guessed at.
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
      isOwnTeam,
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
