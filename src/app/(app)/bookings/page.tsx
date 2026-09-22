import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import {
  listBookings,
  isCalendarConfigured,
  activeCalendarProvider,
  CALENDAR_PROVIDERS,
  CALENDAR_NOT_CONFIGURED,
} from "@/lib/services/bookings";
import { BookingsView } from "@/components/bookings/bookings-view";

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

  const bookings = await listBookings(ctx, { window: active as "upcoming" });

  return (
    <BookingsView
      bookings={bookings}
      window={active}
      calendar={{
        configured: isCalendarConfigured(),
        provider: activeCalendarProvider(),
        notConfiguredMessage: CALENDAR_NOT_CONFIGURED,
        providers: CALENDAR_PROVIDERS,
      }}
    />
  );
}
