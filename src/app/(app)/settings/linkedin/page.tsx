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
  return <LinkedInView variant="settings" reach={reach} targets={[]} />;
}
