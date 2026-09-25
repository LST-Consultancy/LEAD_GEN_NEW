import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { completeMicrosoftConnect } from "@/lib/services/calendar";
import { calendarRedirectUri } from "@/lib/calendar/redirect";
import { MutationError } from "@/lib/services/mutate";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  const q = req.nextUrl.searchParams;
  let message: string;
  try {
    const r = await completeMicrosoftConnect(ctx, { code: q.get("code"), state: q.get("state"), error: q.get("error"), cookieNonce: req.cookies.get("cal_oauth")?.value ?? null, redirectUri: calendarRedirectUri(req.url, "microsoft") });
    message = `Connected ${r.email ?? "your Outlook calendar"}. New bookings create events there.`;
  } catch (e) { message = e instanceof MutationError ? e.message : "Microsoft could not be reached to finish connecting. Nothing was saved."; }
  const res = NextResponse.redirect(new URL(`/settings/calendar?calendar=${encodeURIComponent(message)}`, req.url));
  res.cookies.delete({ name: "cal_oauth", path: "/api/calendar/microsoft" });
  return res;
}
