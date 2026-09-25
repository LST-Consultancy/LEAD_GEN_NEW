import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getNotificationSettings } from "@/lib/services/notification-settings";
import { pushStatus } from "@/lib/services/push";
import { NotificationsSettingsView } from "@/components/admin/notifications-settings-view";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationSettingsPage() {
  const ctx = await requireAuth();
  const [{ kinds, windowDays, totalReceived, totalUnread, emailAvailable, emailAddress }, push] = await Promise.all([getNotificationSettings(ctx), pushStatus(ctx)]);

  return (
    <NotificationsSettingsView
      kinds={kinds}
      windowDays={windowDays}
      totalReceived={totalReceived}
      totalUnread={totalUnread}
      emailAvailable={emailAvailable}
      emailAddress={emailAddress}
      push={push}
    />
  );
}
