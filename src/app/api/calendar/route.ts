import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { calendarStatus, revokeCalendar } from "@/lib/services/calendar";
export async function GET() {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await calendarStatus(ctx)); } catch (error) { return handleApiError(error); }
}
export async function DELETE() {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await revokeCalendar(ctx)); } catch (error) { return handleApiError(error); }
}
