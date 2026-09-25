"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { calendarStatus } from "@/lib/services/calendar";

/** Your own calendar — Google or Microsoft 365: connect through the provider's consent screen, or disconnect. */
export function CalendarConnection({ status, flash }: { status: Awaited<ReturnType<typeof calendarStatus>>; flash: string | null }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(flash ?? "");
  const name = status.provider === "microsoft" ? "Outlook calendar" : "Google Calendar";
  async function disconnect() {
    if (!window.confirm(`Disconnect your ${name}? Future bookings stop creating events; events already created stay.`)) return;
    setBusy(true); try { const r = await api.del<{ note: string }>("/api/calendar"); setMessage(r.note); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not disconnect."); } finally { setBusy(false); }
  }
  return <section className="space-y-2 rounded-lg border border-border bg-surface p-4 text-xs">
    <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-primary">Your calendar</h2>
      <Badge variant={status.connected ? (status.status === "ERROR" ? "danger" : "success") : "neutral"} size="sm">{status.connected ? (status.status === "ERROR" ? "Needs reconnecting" : `${status.provider === "microsoft" ? "Microsoft" : "Google"} · ${status.email ?? "connected"}`) : "Not connected"}</Badge></div>
    <p className="text-secondary">When connected, a meeting you book creates an event in your calendar, moving it updates the event, and cancelling removes it. The lead is invited only when you tick “Send an invitation” while booking. Access asked for: your own calendar&apos;s events and free/busy only.</p>
    {status.lastError && <p className="text-danger-text">{status.lastError}</p>}
    {message && <p role="status" className="rounded border border-border p-2">{message}</p>}
    {status.connected ? <Button size="sm" variant="ghost" disabled={busy} onClick={disconnect}>Disconnect</Button>
      : <div className="flex flex-wrap gap-2">
        {status.configured ? <a href="/api/calendar/google/connect" className="inline-flex items-center rounded-md border border-border px-3 py-1.5 font-medium text-primary hover:bg-surface-hover">Connect Google Calendar</a>
          : <p className="text-warning-text">Google: not available on this server yet — an administrator must register an OAuth client in Google Cloud (callback <code>/api/calendar/google/callback</code>) and set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.</p>}
        {status.microsoftConfigured ? <a href="/api/calendar/microsoft/connect" className="inline-flex items-center rounded-md border border-border px-3 py-1.5 font-medium text-primary hover:bg-surface-hover">Connect Outlook calendar</a>
          : <p className="text-warning-text">Microsoft 365: not available on this server yet — an administrator must register an app in Entra ID with the Calendars.ReadWrite delegated permission (callback <code>/api/calendar/microsoft/callback</code>) and set MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET.</p>}
      </div>}
    <p className="text-2xs text-muted">One calendar per person: connecting one replaces the other. CalDAV calendars (iCloud, Fastmail, self-hosted) are not supported.</p>
  </section>;
}
