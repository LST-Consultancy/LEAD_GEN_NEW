import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

type Client = Pick<typeof db, "notification" | "notificationPreference">;
type Data = Prisma.NotificationUncheckedCreateInput;

/**
 * The one way a notification is raised. It honours the recipient's mute for
 * that kind, so a preference cannot be bypassed by a call site that forgot to
 * check. A muted notification is skipped; the underlying event still has its
 * activity and audit rows, so nothing is lost from the record.
 *
 * Returns whether one was created. Accepts a transaction client so callers
 * that write a notification atomically with other rows can keep doing so.
 */
export async function raiseNotification({ data }: { data: Data }, client: Client = db): Promise<boolean> {
  const muted = await client.notificationPreference.findFirst({
    where: { workspaceId: data.workspaceId, userId: data.userId, kind: data.kind, inApp: false },
    select: { id: true },
  });
  if (muted) return false;
  await client.notification.create({ data });
  return true;
}
