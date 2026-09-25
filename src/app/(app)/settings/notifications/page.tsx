import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getNotificationSettings } from "@/lib/services/notification-settings";
import { NotificationsSettingsView } from "@/components/admin/notifications-settings-view";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationSettingsPage() {
  const ctx = await requireAuth();
  const { kinds, windowDays, totalReceived, totalUnread, emailAvailable, emailAddress } = await getNotificationSettings(ctx);

  return (
    <NotificationsSettingsView
      kinds={kinds}
      windowDays={windowDays}
      totalReceived={totalReceived}
      totalUnread={totalUnread}
      emailAvailable={emailAvailable}
      emailAddress={emailAddress}
    />
  );
}
