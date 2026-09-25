import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { mailRedirectUri, startMailConnect } from "@/lib/services/mailbox-sending";
import { MutationError } from "@/lib/services/mutate";

/** Sends a manager to Google's or Microsoft's consent screen, with a nonce cookie binding the answer to this browser. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  const provider = (await params).provider;
  if (provider !== "gmail" && provider !== "microsoft") return NextResponse.redirect(new URL("/settings/email?mailbox=Unknown%20mail%20provider.", req.url));
  try {
    const { url, nonce } = startMailConnect(ctx, provider, mailRedirectUri(provider, req.url));
    const res = NextResponse.redirect(url);
    res.cookies.set("mail_oauth", nonce, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: `/api/mailboxes/oauth/${provider}`, maxAge: 600 });
    return res;
  } catch (e) {
    return NextResponse.redirect(new URL(`/settings/email?mailbox=${encodeURIComponent(e instanceof MutationError ? e.message : "Could not start the connection.")}`, req.url));
  }
}
