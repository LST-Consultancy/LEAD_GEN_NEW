import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { getCommittee, removeCommitteeMember, setCommitteeMember } from "@/lib/services/committee";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await getCommittee(ctx, (await params).id)); } catch (error) { return handleApiError(error); }
}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await setCommitteeMember(ctx, (await params).id, await req.json())); } catch (error) { return handleApiError(error); }
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); const personId = new URL(req.url).searchParams.get("personId") ?? ""; return NextResponse.json(await removeCommitteeMember(ctx, (await params).id, personId)); } catch (error) { return handleApiError(error); }
}
