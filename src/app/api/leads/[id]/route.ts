import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getLeadDossier } from "@/lib/services/lead-detail";
import { updateLead, updateLeadSchema } from "@/lib/services/lead-mutations";
import { apiError, handleApiError, notFound } from "@/lib/api/respond";
import { resolveCaller } from "@/lib/api/caller";

const uuid = z.string().uuid();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Accepts a browser session or an API key holding "leads.read".
    const caller = await resolveCaller(req.headers, { scope: "leads.read" });
    if (!caller.ok) return caller.response;
    const ctx = caller.ctx;
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That lead reference isn't valid.", 400);

    const lead = await getLeadDossier(ctx, id);
    if (!lead) return notFound("That lead");
    return NextResponse.json(lead);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Accepts a browser session or an API key holding "leads.write".
    const caller = await resolveCaller(req.headers, { scope: "leads.write" });
    if (!caller.ok) return caller.response;
    const ctx = caller.ctx;
    const { id } = await params;
    if (!uuid.safeParse(id).success) return apiError("invalid_request", "That lead reference isn't valid.", 400);

    const input = updateLeadSchema.parse(await req.json());
    if (Object.keys(input).length === 0) {
      return apiError("invalid_request", "Nothing to update.", 400);
    }
    return NextResponse.json(await updateLead(ctx, id, input));
  } catch (err) {
    return handleApiError(err);
  }
}
