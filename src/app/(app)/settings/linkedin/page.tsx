import Link from "next/link";
import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getChannelReach } from "@/lib/services/channels";
import { LinkedInView } from "@/components/integrations/linkedin-view";

export const metadata: Metadata = { title: "LinkedIn" };

export default async function LinkedInSettingsPage() {
  const ctx = await requireAuth();
  // The settings variant lists no targets: this screen is about the scope of
  // what the workflow may do, and a work queue belongs on the channel screen.
  const reach = await getChannelReach(ctx, "linkedin");
  return <div className="space-y-5"><section className="rounded-xl border border-border bg-surface p-5"><h1 className="font-semibold">LinkedIn & Sales Navigator discovery</h1><p className="mt-2 text-sm text-secondary">Connect Brave to discover indexed public posts and review their buying signals. SignalHire can find decision makers through its licensed API. Direct Sales Navigator prospect search requires LinkedIn partner approval and is not connected.</p><div className="mt-3 flex gap-4 text-sm underline"><Link href="/settings/providers">Connect lead sources</Link><Link href="/opportunities/review">Review public post matches</Link></div></section><LinkedInView variant="settings" reach={reach} targets={[]} /></div>;
}
