import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { unauthorized, handleApiError } from "@/lib/api/respond";
import { getOpportunityAction } from "@/lib/services/opportunity-jobs";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await getOpportunityAction(ctx, (await params).id)); } catch(e) { return handleApiError(e); } }
