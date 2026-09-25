import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import {
  CALENDAR_PROVIDERS,
  activeCalendarProvider,
  listBookings,
} from "@/lib/services/bookings";
import { needsOutcomeRecorded } from "@/lib/bookings/outcome";
import { CalendarSettingsView } from "@/components/admin/calendar-settings-view";
import { BookingUrlForm } from "@/components/admin/booking-url-form";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { calendarStatus } from "@/lib/services/calendar";
import { CalendarConnection } from "@/components/admin/calendar-connection";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarSettingsPage({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  const ctx = await requireAuth();
  const [{ calendar: flash }, calendar] = await Promise.all([searchParams, calendarStatus(ctx)]);
  const [bookings, workspace] = await Promise.all([
    listBookings(ctx, { window: "all" }),
    db.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { bookingUrl: true } }),
  ]);

  return (
    <div className="flex flex-col gap-3">
    <CalendarConnection status={calendar} flash={flash?.slice(0, 400) ?? null} />
    <BookingUrlForm initial={workspace?.bookingUrl ?? null} canEdit={ctx.permissions.includes(PERMISSIONS.WORKSPACE_MANAGE)} />
    <CalendarSettingsView
      providers={CALENDAR_PROVIDERS}
      active={activeCalendarProvider()}
      bookingCount={bookings.length}
      // Same predicate the Bookings screen uses, so the two counts agree.
      needingOutcome={bookings.filter(needsOutcomeRecorded).length}
    />
    </div>
  );
}
