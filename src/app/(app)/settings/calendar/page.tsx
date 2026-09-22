import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import {
  CALENDAR_PROVIDERS,
  activeCalendarProvider,
  listBookings,
} from "@/lib/services/bookings";
import { needsOutcomeRecorded } from "@/lib/bookings/outcome";
import { CalendarSettingsView } from "@/components/admin/calendar-settings-view";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarSettingsPage() {
  const ctx = await requireAuth();
  const bookings = await listBookings(ctx, { window: "all" });

  return (
    <CalendarSettingsView
      providers={CALENDAR_PROVIDERS}
      active={activeCalendarProvider()}
      bookingCount={bookings.length}
      // Same predicate the Bookings screen uses, so the two counts agree.
      needingOutcome={bookings.filter(needsOutcomeRecorded).length}
    />
  );
}
