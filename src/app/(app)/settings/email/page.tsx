import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import {
  EMAIL_PROVIDERS,
  activeEmailProvider,
  canReceiveReplies,
} from "@/lib/outreach/provider";
import { getChannelReach } from "@/lib/services/channels";
import { EmailAccountsView } from "@/components/integrations/email-accounts-view";

export const metadata: Metadata = { title: "Email Accounts" };

/**
 * Declared here rather than stored: nothing in this product can read or set a
 * DNS record, so there is no check result to persist. The failure modes are
 * the useful part — each one is silent, which is why they are spelled out.
 */
const DOMAIN_CHECKS = [
  {
    record: "SPF",
    purpose: "Names the servers allowed to send as your domain.",
    failureMode:
      "Mail is accepted but scored as suspicious. Delivery looks fine in your sent folder and never reaches the inbox.",
  },
  {
    record: "DKIM",
    purpose: "Signs each message so the recipient can prove it wasn't altered.",
    failureMode:
      "Without a valid signature, a forwarded message fails alignment and lands in spam — most often the one your prospect forwards internally.",
  },
  {
    record: "DMARC",
    purpose: "Tells receivers what to do when SPF or DKIM fails, and where to send reports.",
    failureMode:
      "At p=reject with a misconfigured SPF you block your own mail. At p=none you get no protection and no warning.",
  },
];

export default async function EmailAccountsPage() {
  const ctx = await requireAuth();
  const reach = await getChannelReach(ctx, "email");

  return (
    <EmailAccountsView
      providers={Object.values(EMAIL_PROVIDERS)}
      active={activeEmailProvider()}
      canReceive={canReceiveReplies()}
      reach={reach}
      domainChecks={DOMAIN_CHECKS}
    />
  );
}
