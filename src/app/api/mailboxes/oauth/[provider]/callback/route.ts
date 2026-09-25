import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { completeMailConnect, mailRedirectUri } from "@/lib/services/mailbox-sending";
import { MutationError } from "@/lib/services/mutate";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  const provider = (await params).provider;
  if (provider !== "gmail" && provider !== "microsoft") return NextResponse.redirect(new URL("/settings/email?mailbox=Unknown%20mail%20provider.", req.url));
  const q = req.nextUrl.searchParams;
  let message: string;
  try {
    const r = await completeMailConnect(ctx, provider, { code: q.get("code"), state: q.get("state"), error: q.get("error"), cookieNonce: req.cookies.get("mail_oauth")?.value ?? null, redirectUri: mailRedirectUri(provider, req.url) });
    message = r.note;
  } catch (e) { message = e instanceof MutationError ? e.message : "The provider could not be reached to finish connecting. Nothing was saved."; }
  const res = NextResponse.redirect(new URL(`/settings/email?mailbox=${encodeURIComponent(message)}`, req.url));
  res.cookies.delete({ name: "mail_oauth", path: `/api/mailboxes/oauth/${provider}` });
  return res;
}
