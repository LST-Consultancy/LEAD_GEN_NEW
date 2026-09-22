import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { listKnowledge } from "@/lib/services/knowledge";
import { createKnowledgeDoc } from "@/lib/services/knowledge-mutations";
import { handleApiError, unauthorized } from "@/lib/api/respond";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const params = req.nextUrl.searchParams;
    return NextResponse.json(
      await listKnowledge(ctx, {
        kind: params.get("kind") ?? undefined,
        query: params.get("q") ?? undefined,
        includeInactive: params.get("includeInactive") === "1",
      })
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await createKnowledgeDoc(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
