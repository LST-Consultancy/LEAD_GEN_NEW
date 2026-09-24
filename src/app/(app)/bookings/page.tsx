import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import {
  listBookings,
  canSyncCalendar,
  activeCalendarProvider,
  CALENDAR_PROVIDERS,
  CALENDAR_NOT_CONFIGURED,
} from "@/lib/services/bookings";
import { BookingsView } from "@/components/bookings/bookings-view";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Bookings" };

const WINDOWS = new Set(["upcoming", "past", "all"]);

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const ctx = await requireAuth();
  const { window } = await searchParams;
  // Parsed tolerantly: a stale bookmark should not 500.
  const active = window && WINDOWS.has(window) ? window : "upcoming";

  const [bookings, workspace] = await Promise.all([
    listBookings(ctx, { window: active as "upcoming" }),
    db.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { bookingUrl: true } }),
  ]);

  return (
    <BookingsView
      bookings={bookings}
      window={active}
      bookingUrl={workspace?.bookingUrl ?? null}
      calendar={{
        configured: canSyncCalendar(),
        provider: activeCalendarProvider(),
        notConfiguredMessage: CALENDAR_NOT_CONFIGURED,
        providers: CALENDAR_PROVIDERS,
      }}
    />
  );
}
