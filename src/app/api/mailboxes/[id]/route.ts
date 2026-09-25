import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { revokeMailbox } from "@/lib/services/mailboxes";
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await revokeMailbox(ctx, (await params).id)); } catch (error) { return handleApiError(error); }
}
