import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { setMemberRouting } from "@/lib/services/team-routing";
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await setMemberRouting(ctx, (await params).id, await req.json())); } catch (error) { return handleApiError(error); }
}
