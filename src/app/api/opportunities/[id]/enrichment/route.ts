import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { getOpportunityEnrichment, startEnrichment } from "@/lib/services/enrichment";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await getOpportunityEnrichment(ctx, (await params).id)); } catch (error) { return handleApiError(error); }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await startEnrichment(ctx, (await params).id, await req.json().catch(() => ({})))); } catch (error) { return handleApiError(error); }
}
