import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { opportunityToCrm } from "@/lib/services/opportunity-actions";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await opportunityToCrm(ctx, (await params).id, await req.json().catch(() => ({})))); } catch (error) { return handleApiError(error); }
}
