import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { reviewDiscoveryCandidate } from "@/lib/services/discovery-review";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await reviewDiscoveryCandidate(ctx, (await params).id, await request.json())); } catch (error) { return handleApiError(error); }
}
