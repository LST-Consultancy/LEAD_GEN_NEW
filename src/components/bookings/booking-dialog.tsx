"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api, bookingsApi } from "@/lib/api/client";

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Nothing was changed.");
const LENGTHS = [15, 30, 45, 60, 90];
const viewerTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Local date + time + length → start/end instants, or null if incomplete. */
function slot(date: string, time: string, minutes: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const startsAt = new Date(`${date}T${time}:00`);
  return { startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + minutes * 60_000).toISOString() };
}

/** Books a meeting from the Bookings page, with or without a lead. */
export function NewMeetingButton({ bookingUrl }: { bookingUrl: string | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<{ id: string; name: string; company: string }[]>([]);
  const [lead, setLead] = React.useState<{ id: string; name: string; company: string } | null>(null);
  const [title, setTitle] = React.useState("");
  const [date, setDate] = React.useState("");
  const [time, setTime] = React.useState("11:00");
  const [minutes, setMinutes] = React.useState(30);
  const [location, setLocation] = React.useState("");
  const [meetingUrl, setMeetingUrl] = React.useState("");
  const [agenda, setAgenda] = React.useState("");
  const [invite, setInvite] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (lead || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => { api.get<{ leads: { id: string; name: string; company: string }[] }>(`/api/leads?q=${encodeURIComponent(q.trim())}`).then((r) => setHits(r.leads), () => setHits([])); }, 250);
    return () => clearTimeout(t);
  }, [q, lead]);

  const s = slot(date, time, minutes);
  async function submit() {
    if (!s) return;
    setPending(true); setError("");
    try {
      const r = await bookingsApi.create({
        ...(lead ? { leadId: lead.id } : {}), title: title.trim(), ...s, timezone: viewerTz(),
        ...(location.trim() ? { location: location.trim() } : {}), ...(meetingUrl.trim() ? { meetingUrl: meetingUrl.trim() } : {}), ...(agenda.trim() ? { agenda: agenda.trim() } : {}), invite: Boolean(lead) && invite,
      }) as { note?: string; clash?: string | null };
      toast.success("Meeting booked", { description: r.clash ?? r.note });
      setOpen(false); router.refresh();
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => { setError(""); setOpen(true); }}><CalendarPlus />New meeting</Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Book a meeting</DialogTitle>
            <DialogDescription>
              Recorded here with a brief and outcome capture. No calendar is connected, so no invite is sent — arrange it in your own calendar{bookingUrl ? <>, or send them your <a className="underline" href={bookingUrl} target="_blank" rel="noreferrer">booking link</a></> : null}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Lead" htmlFor="nm-lead" hint="Optional. A meeting with a lead carries its brief.">
              {lead ? (
                <p className="text-xs text-primary">{lead.name} <span className="text-muted">· {lead.company}</span> <button type="button" className="text-2xs text-muted underline" onClick={() => setLead(null)}>change</button></p>
              ) : (
                <div className="relative">
                  <Input id="nm-lead" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads" autoComplete="off" />
                  {hits.length ? (
                    <ul className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-raised">
                      {hits.map((h) => <li key={h.id}><button type="button" className="w-full px-2 py-1.5 text-left text-xs hover:bg-surface-hover" onClick={() => { setLead(h); setQ(""); if (!title) setTitle(`${h.name} · ${h.company}`); }}>{h.name} <span className="text-muted">· {h.company}</span></button></li>)}
                    </ul>
                  ) : null}
                </div>
              )}
            </Field>
            <Field label="Title" htmlFor="nm-title" required><Input id="nm-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Date" htmlFor="nm-date" required><Input id="nm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Start" htmlFor="nm-time" required><Input id="nm-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
              <Field label="Length" htmlFor="nm-len">
                <select id="nm-len" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
                  {LENGTHS.map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </Field>
            </div>
            <p className="text-2xs text-muted">Times are in your timezone ({viewerTz()}).</p>
            <Field label="Location" htmlFor="nm-loc"><Input id="nm-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} /></Field>
            <Field label="Meeting link" htmlFor="nm-url"><Input id="nm-url" type="url" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} maxLength={500} placeholder="https://meet.google.com/…" /></Field>
            <Field label="Agenda" htmlFor="nm-agenda"><Textarea id="nm-agenda" rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} maxLength={5000} /></Field>
            {lead ? <label className="flex items-start gap-2 text-xs text-secondary"><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} className="mt-0.5" /><span>Send an invitation to {lead.name} from my connected calendar. Off by default: an invitation is an email to them. Without a connected calendar nothing is sent either way.</span></label> : null}
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" size="sm" loading={pending} disabled={!s || title.trim().length < 2} onClick={() => void submit()}>Book meeting</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Reschedule and cancel for a meeting that has not happened yet. */
export function BookingCardActions({ booking }: { booking: { id: string; title: string; startsAt: string; durationMin: number } }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"move" | "cancel" | null>(null);
  const start = new Date(booking.startsAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const [date, setDate] = React.useState(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
  const [time, setTime] = React.useState(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
  const [minutes, setMinutes] = React.useState(LENGTHS.includes(booking.durationMin) ? booking.durationMin : 30);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const s = slot(date, time, minutes);

  async function submit() {
    setPending(true); setError("");
    try {
      const r = mode === "move"
        ? await api.patch<{ note: string }>(`/api/bookings/${booking.id}`, { ...s, timezone: viewerTz(), ...(reason.trim() ? { reason: reason.trim() } : {}) })
        : await api.del<{ note: string }>(`/api/bookings/${booking.id}`, { reason: reason.trim() });
      toast.success(mode === "move" ? "Meeting moved" : "Meeting cancelled", { description: r.note });
      setMode(null); setReason(""); router.refresh();
    } catch (err) { setError(errorText(err)); } finally { setPending(false); }
  }

  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => { setError(""); setMode("move"); }}>Reschedule</Button>
      <Button size="xs" variant="ghost" onClick={() => { setError(""); setMode("cancel"); }}>Cancel</Button>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{mode === "move" ? "Move this meeting" : "Cancel this meeting"}</DialogTitle>
            <DialogDescription>{booking.title}. No calendar is connected, so nobody is notified — tell them yourself.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {mode === "move" ? (
              <div className="grid grid-cols-3 gap-2">
                <Field label="Date" htmlFor="rb-date"><Input id="rb-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label="Start" htmlFor="rb-time"><Input id="rb-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
                <Field label="Length" htmlFor="rb-len">
                  <select id="rb-len" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
                    {LENGTHS.map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                </Field>
              </div>
            ) : null}
            <Field label={mode === "move" ? "Why (optional)" : "Why"} htmlFor="rb-reason" required={mode === "cancel"}><Input id="rb-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setMode(null)} disabled={pending}>Back</Button>
            <Button variant={mode === "cancel" ? "danger" : "primary"} size="sm" loading={pending} disabled={mode === "move" ? !s : reason.trim().length < 3} onClick={() => void submit()}>{mode === "move" ? "Move meeting" : "Cancel meeting"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
