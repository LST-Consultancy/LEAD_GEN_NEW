import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { deleteOffering, updateOffering } from "@/lib/services/offerings";
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await updateOffering(ctx, (await params).id, await req.json())); } catch (error) { return handleApiError(error); }
}
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await deleteOffering(ctx, (await params).id)); } catch (error) { return handleApiError(error); }
}
