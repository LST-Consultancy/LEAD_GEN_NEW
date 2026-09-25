import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { pushFeed } from "@/lib/services/push";
/** Read by the service worker after a push wake-up, over the person's own session cookie. */
export async function GET() {
  try { const ctx = await getAuthContext(); if (!ctx) return unauthorized(); return NextResponse.json(await pushFeed(ctx), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return handleApiError(error); }
}
