import { NextResponse, type NextRequest } from "next/server";
import { decidePublicProposal } from "@/lib/services/proposal-public";
import { handleApiError, tooManyRequests } from "@/lib/api/respond";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

/** Unauthenticated. The token is the authorisation; the service re-checks it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;

    // Unauthenticated, and the token is a bearer secret sitting in a URL. Keyed
    // on the source rather than the token: keying on the token would let an
    // attacker guess a fresh one each time and never hit the limit, which is
    // precisely the attack.
    const limit = await rateLimit("publicToken", `ip:${clientKey(req.headers)}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "attempts");

    return NextResponse.json(await decidePublicProposal(token, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
