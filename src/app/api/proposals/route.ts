import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { createProposal, listProposals } from "@/lib/services/proposals";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { resolveCaller } from "@/lib/api/caller";

export async function GET(req: NextRequest) {
  try {
    // Accepts a browser session or an API key holding "proposals.read".
    const caller = await resolveCaller(req.headers, { scope: "proposals.read" });
    if (!caller.ok) return caller.response;
    const ctx = caller.ctx;
    return NextResponse.json(await listProposals(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await createProposal(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
