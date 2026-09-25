import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

type Client = Pick<typeof db, "notification" | "notificationPreference">;
type Data = Prisma.NotificationUncheckedCreateInput;

/**
 * The one way a notification is raised. It honours the recipient's preferences for that kind, so
 * a preference cannot be bypassed by a call site that forgot to check:
 * - in-app muted, email off and push off → skipped (the event still has its activity and audit rows);
 * - in-app muted but email on → recorded as already read, so it is emailed without a badge;
 * - otherwise → an ordinary unread notification, emailed too when email is on.
 * Email itself is sent by the notification-email job, never inline, so a slow mail server cannot
 * hold up the action that raised it.
 *
 * Returns whether one was created. Accepts a transaction client so callers that write a
 * notification atomically with other rows can keep doing so.
 */
export async function raiseNotification({ data }: { data: Data }, client: Client = db): Promise<boolean> {
  const pref = await client.notificationPreference.findFirst({
    where: { workspaceId: data.workspaceId, userId: data.userId, kind: data.kind },
    select: { inApp: true, email: true, push: true },
  });
  if (pref && !pref.inApp && !pref.email && !pref.push) return false;
  await client.notification.create({ data: pref && !pref.inApp ? { ...data, readAt: new Date() } : data });
  return true;
}
