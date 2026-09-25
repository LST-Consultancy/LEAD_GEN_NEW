import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { startMicrosoftConnect } from "@/lib/services/calendar";
import { calendarRedirectUri } from "@/lib/calendar/redirect";
import { MutationError } from "@/lib/services/mutate";

/** Sends the signed-in person to Microsoft's consent screen, with a nonce in an httpOnly cookie to bind the answer to this browser. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  try {
    const { url, nonce } = startMicrosoftConnect(ctx, calendarRedirectUri(req.url, "microsoft"));
    const res = NextResponse.redirect(url);
    res.cookies.set("cal_oauth", nonce, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/api/calendar/microsoft", maxAge: 600 });
    return res;
  } catch (e) {
    return NextResponse.redirect(new URL(`/settings/calendar?calendar=${encodeURIComponent(e instanceof MutationError ? e.message : "Could not start the connection.")}`, req.url));
  }
}
