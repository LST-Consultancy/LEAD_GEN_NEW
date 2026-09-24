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

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarSettingsPage() {
  const ctx = await requireAuth();
  const [bookings, workspace] = await Promise.all([
    listBookings(ctx, { window: "all" }),
    db.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { bookingUrl: true } }),
  ]);

  return (
    <div className="flex flex-col gap-3">
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
