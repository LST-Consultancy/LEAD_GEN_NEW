import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getChannelReach, listLinkedInTargets } from "@/lib/services/channels";
import { LinkedInView } from "@/components/integrations/linkedin-view";

export const metadata: Metadata = { title: "LinkedIn" };

export default async function LinkedInPage() {
  const ctx = await requireAuth();
  const [reach, targets] = await Promise.all([
    getChannelReach(ctx, "linkedin"),
    listLinkedInTargets(ctx),
  ]);

  return <LinkedInView variant="channel" reach={reach} targets={targets} />;
}
