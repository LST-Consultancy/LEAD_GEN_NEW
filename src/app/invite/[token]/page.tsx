import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/shell/brandmark";
import { readSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { previewInvitation } from "@/lib/services/team";
import { AcceptInvitationForm } from "./accept-form";

export const metadata: Metadata = { title: "Join workspace", robots: { index: false } };

const ENDED: Record<string, { title: string; body: string }> = {
  invalid: { title: "This link doesn't work", body: "It may have been copied incompletely. Ask whoever invited you for a new one." },
  expired: { title: "This invitation has expired", body: "Ask whoever invited you to resend it — that makes a fresh link." },
  revoked: { title: "This invitation was withdrawn", body: "Ask whoever invited you if you still need access." },
  accepted: { title: "This invitation has been used", body: "If it was you, sign in to reach the workspace." },
};

/**
 * Outside both the app and the sign-in layouts: the app layout would demand a
 * session, and the sign-in layout redirects anyone who has one — which would
 * stop an existing user joining a second workspace.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await previewInvitation(token);
  const session = await readSession();
  const signedInEmail = session ? (await db.user.findUnique({ where: { id: session.userId }, select: { email: true } }))?.email ?? null : null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <Wordmark />
        {preview.state === "valid" ? (
          <AcceptInvitationForm
            token={token}
            email={preview.email}
            workspaceName={preview.workspaceName}
            roleName={preview.roleName}
            hasAccount={preview.hasAccount}
            signedInEmail={signedInEmail}
          />
        ) : (
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-primary">{ENDED[preview.state].title}</h1>
            <p className="text-sm text-secondary">{ENDED[preview.state].body}</p>
            <Link href="/login" className="inline-block text-sm text-brand-text hover:underline">Go to sign in</Link>
          </div>
        )}
      </div>
    </div>
  );
}
