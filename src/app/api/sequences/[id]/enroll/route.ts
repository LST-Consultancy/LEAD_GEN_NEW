import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { enrollLeads, listEnrollments, unenrollLead } from "@/lib/services/sequences";
import { apiError, handleApiError, notFound, unauthorized } from "@/lib/api/respond";

const uuid = z.string().uuid();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That sequence reference isn't valid.", 400);
    const rows = await listEnrollments(ctx, id);
    if (!rows) return notFound("That sequence");
    return NextResponse.json({ enrollments: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!uuid.safeParse(id).success) {
      return apiError("invalid_request", "That sequence reference isn't valid.", 400);
    }
    return NextResponse.json(await enrollLeads(ctx, id, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    const leadId = new URL(req.url).searchParams.get("leadId");
    if (!uuid.safeParse(id).success || !leadId || !uuid.safeParse(leadId).success) {
      return apiError("invalid_request", "Both the sequence and lead references are needed.", 400);
    }
    return NextResponse.json(await unenrollLead(ctx, id, leadId));
  } catch (err) {
    return handleApiError(err);
  }
}
