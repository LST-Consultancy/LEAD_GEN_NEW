import { listSenders, sendingReady } from "@/lib/services/mailbox-sending";
import { readsReplies } from "@/lib/services/mailboxes";
import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { listSequences } from "@/lib/services/sequences";
import {
  EMAIL_PROVIDERS,
  EMAIL_NOT_CONFIGURED,
  REPLIES_NOT_READABLE,
  activeEmailProvider,
  } from "@/lib/outreach/provider";
import { OutreachView } from "@/components/outreach/outreach-view";

export const metadata: Metadata = { title: "Outreach" };

export default async function OutreachPage() {
  const ctx = await requireAuth();
  const replies = await readsReplies(ctx.workspaceId);
  const [sequences, senders, suppressionCount] = await Promise.all([
    listSequences(ctx),
    listSenders(ctx),
    db.suppression.count({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  return (
    <OutreachView
      sequences={sequences}
      suppressionCount={suppressionCount}
      senders={senders}
      provider={{
        configured: await sendingReady(ctx.workspaceId),
        provider: activeEmailProvider(),
        canReceive: replies,
        notConfiguredMessage: EMAIL_NOT_CONFIGURED,
        repliesNotReadableMessage: REPLIES_NOT_READABLE,
        catalogue: Object.values(EMAIL_PROVIDERS),
      }}
    />
  );
}
