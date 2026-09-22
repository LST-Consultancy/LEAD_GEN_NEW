import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getMyQueue } from "@/lib/services/queue";
import { QueueView } from "@/components/queue/queue-view";

export const metadata: Metadata = { title: "My Queue" };

export default async function MyQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireAuth();
  const queue = await getMyQueue(ctx);
  const tab = (await searchParams).tab;

  const initialTab =
    tab === "needs-you"
      ? "NEEDS_ATTENTION"
      : tab === "working"
        ? "WORKING"
        : tab === "done"
          ? "DONE"
          : queue.counts.NEEDS_ATTENTION > 0
            ? "NEEDS_ATTENTION"
            : "QUEUED";

  return (
    <QueueView
      lanes={queue.lanes}
      counts={queue.counts}
      summary={queue.summary}
      focusOrder={queue.focusOrder}
      initialTab={initialTab}
    />
  );
}
