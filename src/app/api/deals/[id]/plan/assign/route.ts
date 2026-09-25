import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { autoAssignPlan } from "@/lib/services/team-routing";
/** POST { dryRun?: boolean } — preview or apply skill-and-capacity assignment of unowned steps. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean }; return NextResponse.json(await autoAssignPlan(ctx, (await params).id, { dryRun: body.dryRun === true })); } catch (error) { return handleApiError(error); }
}
