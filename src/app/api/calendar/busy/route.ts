import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { busyTimes } from "@/lib/services/calendar";
export async function POST(req: NextRequest) {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await busyTimes(ctx, await req.json())); } catch (error) { return handleApiError(error); }
}
