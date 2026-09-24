import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { retryDiscoveryAttribution } from "@/lib/services/discovery-review";
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await retryDiscoveryAttribution(ctx, (await params).id)); } catch (error) { return handleApiError(error); }
}
