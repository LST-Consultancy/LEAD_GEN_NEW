import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { connectOpportunityProvider, disconnectOpportunityProvider } from "@/lib/services/opportunity-providers";
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await connectOpportunityProvider(ctx, (await params).provider, await req.json())); } catch (error) { return handleApiError(error); }
}
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await disconnectOpportunityProvider(ctx, (await params).provider)); } catch (error) { return handleApiError(error); }
}
