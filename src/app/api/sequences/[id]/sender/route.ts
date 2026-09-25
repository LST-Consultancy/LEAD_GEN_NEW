import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { setSequenceSender } from "@/lib/services/mailbox-sending";
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await setSequenceSender(ctx, (await params).id, await req.json().catch(() => ({})))); } catch (error) { return handleApiError(error); }
}
