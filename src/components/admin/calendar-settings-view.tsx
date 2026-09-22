"use client";

import Link from "next/link";
import { AlertTriangle, Calendar, Check, Info, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

type Provider = { name: string; label: string; requires: string; gives: string };

/**
 * §55 — calendar.
 *
 * Read-only, like the email screen and for the same reason: no OAuth flow
 * exists, so a "Connect" button would open nothing. What is real is the
 * booking record itself, and the screen leads with that rather than with the
 * gap.
 */
export function CalendarSettingsView({
  providers,
  active,
  bookingCount,
  needingOutcome,
}: {
  providers: readonly Provider[];
  active: string | null;
  bookingCount: number;
  needingOutcome: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Calendar</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Meetings are recorded against the lead so the brief, the outcome and the pipeline stay in
          one place. Connecting a calendar would add the invite; it is not what makes the record
          useful.
        </p>
      </div>

      {active ? (
        <div className="rounded-lg border border-success-border bg-success-subtle px-3 py-2.5 text-xs text-success-text">
          <Check className="mr-1 inline size-3.5" />
          <strong>{active}</strong> is credentialled.
        </div>
      ) : (
        <div className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2.5 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>No calendar is connected, and no adapter is built.</strong> Nothing here creates
          an event or sends an invite — you arrange the meeting in your own calendar and record it
          against the lead. Booking, rescheduling and outcome capture all work today.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Calendar className="size-3.5 text-muted" />
            What is recorded today
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-2xs leading-relaxed text-secondary">
            {bookingCount === 0
              ? "No meeting has been recorded yet."
              : `${formatNumber(bookingCount)} meetings recorded.`}
            {needingOutcome > 0 ? (
              <>
                {" "}
                <Link href="/bookings" className="text-brand-text underline-offset-2 hover:underline">
                  {formatNumber(needingOutcome)} still need an outcome
                </Link>{" "}
                — a meeting with no outcome tells the forecast nothing.
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Providers</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          {providers.map((p) => (
            <div
              key={p.name}
              className="rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {active === p.name ? (
                  <Check className="size-3 text-success-text" />
                ) : (
                  <X className="size-3 text-muted" />
                )}
                <span className="text-xs font-medium text-primary">{p.label}</span>
                <Badge variant={active === p.name ? "success" : "neutral"} size="sm">
                  {active === p.name ? "Credentialled" : "Not connected"}
                </Badge>
              </div>
              <p className="mt-0.5 text-2xs text-secondary">{p.gives}</p>
              <p className="text-2xs text-muted">
                <strong>Would need:</strong> {p.requires}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Free/busy is the part that needs a real connection: without it, any availability this
        product showed would be a guess, and double-booking a prospect costs more than the
        convenience is worth.
      </p>
    </div>
  );
}
