import { listMailboxes, readsReplies } from "@/lib/services/mailboxes";
import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import {
  ADAPTER_BUILT,
  EMAIL_PROVIDERS,
  activeEmailProvider,
  canActuallySend,
} from "@/lib/outreach/provider";
import { getChannelReach } from "@/lib/services/channels";
import { EmailAccountsView } from "@/components/integrations/email-accounts-view";
import { MailboxesPanel } from "@/components/integrations/mailboxes-panel";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { mailOAuthConfigured } from "@/lib/outreach/adapters/oauth-mail";

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

export default async function EmailAccountsPage({ searchParams }: { searchParams: Promise<{ mailbox?: string }> }) {
  const ctx = await requireAuth();
  const notice = (await searchParams).mailbox?.slice(0, 400) ?? null;
  const [replies, mailboxes] = await Promise.all([readsReplies(ctx.workspaceId), listMailboxes(ctx)]);
  const reach = await getChannelReach(ctx, "email");

  return (
    <EmailAccountsView
      providers={Object.values(EMAIL_PROVIDERS).map((p) => ({
        ...p,
        adapterBuilt: ADAPTER_BUILT[p.name],
      }))}
      active={activeEmailProvider()}
      canSend={canActuallySend()}
      canReceive={replies}
      reach={reach}
      domainChecks={DOMAIN_CHECKS}
      workspaceSender={mailboxes.find((m) => m.isDefaultSender && m.sendStatus === "CONNECTED" && !m.revokedAt)?.address ?? null}
    >
      <MailboxesPanel initial={mailboxes} canManage={ctx.permissions.includes(PERMISSIONS.WORKSPACE_MANAGE)} notice={notice} oauth={{ gmail: mailOAuthConfigured("gmail"), microsoft: mailOAuthConfigured("microsoft") }} />
    </EmailAccountsView>
  );
}
