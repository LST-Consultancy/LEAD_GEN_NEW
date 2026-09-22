import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { getInternalDossier } from "@/lib/services/research";
import { handleApiError, unauthorized, notFound } from "@/lib/api/respond";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { leadId } = await params;
    const dossier = await getInternalDossier(ctx, leadId);
    // Out of tenant, out of visibility and non-existent all produce the same
    // 404 — the three must be indistinguishable from outside.
    if (!dossier) return notFound();
    return NextResponse.json(dossier);
  } catch (err) {
    return handleApiError(err);
  }
}
