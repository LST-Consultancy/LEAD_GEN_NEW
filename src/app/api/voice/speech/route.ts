import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, unauthorized } from "@/lib/api/respond";
import { generateSpeech } from "@/lib/services/voice";
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext(); if (!ctx) return unauthorized();
    const audio = await generateSpeech(ctx, await req.json());
    return new NextResponse(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Content-Disposition": 'attachment; filename="signalroom-audio.mp3"', "Cache-Control": "no-store" } });
  } catch (error) { return handleApiError(error); }
}
