import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import {
  beginMfaEnrolment,
  confirmMfaEnrolment,
  disableMfa,
  getMfaStatus,
} from "@/lib/services/mfa";
import { handleApiError, tooManyRequests, unauthorized } from "@/lib/api/respond";
import { rateLimit } from "@/lib/security/rate-limit";

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await getMfaStatus(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}

/** Starts enrolment, returning the secret and the URI an app scans. */
export async function POST() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await beginMfaEnrolment(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}

/** Confirms enrolment with a code from the app, and returns the recovery codes. */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    // Guessing a six-digit code is a million tries; this makes that impractical
    // without locking anyone out of a genuine typo.
    const limit = await rateLimit("login", `mfa:${ctx.userId}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "code attempts");

    return NextResponse.json(await confirmMfaEnrolment(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}

/** Turning it off needs a current code — a session alone is not enough. */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    const limit = await rateLimit("login", `mfa:${ctx.userId}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "code attempts");

    return NextResponse.json(await disableMfa(ctx, await req.json()));
  } catch (err) {
    return handleApiError(err);
  }
}
