import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getInboxCounts, getMailboxStatus, listConversations } from "@/lib/services/inbox";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata: Metadata = { title: "Inbox" };

const FILTERS = new Set([
  "needs_you",
  "waiting",
  "open",
  "snoozed",
  "closed",
  "all",
  "unread",
]);

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const ctx = await requireAuth();
  const { filter } = await searchParams;
  // Parse tolerantly: a stale bookmark should not 500.
  const active = filter && FILTERS.has(filter) ? filter : "needs_you";

  const [conversations, counts, mailbox] = await Promise.all([
    listConversations(ctx, { filter: active as "needs_you" }),
    getInboxCounts(ctx),
    getMailboxStatus(ctx),
  ]);

  return (
    <InboxView
      conversations={conversations}
      counts={counts}
      mailbox={mailbox}
      activeFilter={active}
    />
  );
}
