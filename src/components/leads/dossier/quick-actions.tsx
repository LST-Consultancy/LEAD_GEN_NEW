"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Briefcase, CalendarPlus, Copy, FileText, Mail, MessageCircle, Phone, Reply, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, activityApi, api, bookingsApi } from "@/lib/api/client";

type Contact = { kind: string; value: string | null; isLocked: boolean; optedOutAt: string | null };
type Lead = { id: string; name: string; companyName: string; contacts: Contact[] };
type Mode = "email" | "whatsapp" | "linkedin" | "call" | "meeting" | "reply" | null;
type Language = "en" | "hinglish" | "hi";
const LANGUAGES: [Language, string][] = [["en", "English"], ["hinglish", "Hinglish"], ["hi", "Hindi"]];
const CHANNEL_NAME = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn" } as const;

const reachable = (contacts: Contact[], kinds: string[]) =>
  contacts.find((c) => kinds.includes(c.kind) && !c.isLocked && c.value && !c.optedOutAt)?.value ?? null;

function reportError(action: string, err: unknown) {
  toast.error(`Couldn't ${action}`, { description: err instanceof ApiError ? err.message : "Something went wrong. Nothing was changed." });
}

/**
 * The lead's working actions. Nothing here sends a message: email and WhatsApp
 * open the rep's own app with a reviewed draft and then record the touch, which
 * is what an unconnected workspace can honestly do. Sequences send once a
 * mailbox is connected.
 */
export function LeadQuickActions({ lead }: { lead: Lead }) {
  const params = useSearchParams();
  const requested = params.get("do");
  // Opened from a task's "Do it": start in that task's dialog.
  const [mode, setMode] = React.useState<Mode>(["email", "whatsapp", "linkedin", "call", "meeting", "reply"].includes(requested ?? "") ? (requested as Mode) : null);
  const email = reachable(lead.contacts, ["WORK_EMAIL", "PERSONAL_EMAIL"]);
  const phone = reachable(lead.contacts, ["MOBILE", "DIRECT_PHONE", "SWITCHBOARD"]);
  const whatsapp = reachable(lead.contacts, ["WHATSAPP", "MOBILE"]);
  const linkedin = reachable(lead.contacts, ["LINKEDIN_URL"]);
  const close = () => setMode(null);

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setMode("email")}><Mail />Email</Button>
      <Button variant="secondary" size="sm" onClick={() => setMode("whatsapp")}><MessageCircle />WhatsApp</Button>
      <Button variant="secondary" size="sm" onClick={() => setMode("linkedin")}><Briefcase />LinkedIn</Button>
      <Button variant="secondary" size="sm" onClick={() => setMode("call")}><Phone />Call</Button>
      <Button variant="secondary" size="sm" onClick={() => setMode("meeting")}><CalendarPlus />Meeting</Button>
      <Button variant="secondary" size="sm" asChild><Link href={`/proposals/new?leadId=${lead.id}`}><FileText />Proposal</Link></Button>
      <Button variant="ghost" size="sm" onClick={() => setMode("reply")}><Reply />Log reply</Button>

      {mode === "email" || mode === "whatsapp" || mode === "linkedin" ? (
        <MessageDialog lead={lead} channel={mode} recipient={mode === "email" ? email : mode === "whatsapp" ? whatsapp : linkedin} onClose={close} />
      ) : null}
      {mode === "call" ? <CallDialog lead={lead} phone={phone} onClose={close} /> : null}
      {mode === "meeting" ? <MeetingDialog lead={lead} onClose={close} /> : null}
      {mode === "reply" ? <ReplyDialog lead={lead} onClose={close} /> : null}
    </>
  );
}

function MessageDialog({ lead, channel, recipient, onClose }: { lead: Lead; channel: "email" | "whatsapp" | "linkedin"; recipient: string | null; onClose: () => void }) {
  const router = useRouter();
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [drafting, setDrafting] = React.useState(false);
  const [logging, setLogging] = React.useState(false);
  const [grounding, setGrounding] = React.useState<{ groundedOn: string[]; withheld: string | null } | null>(null);
  const [language, setLanguage] = React.useState<Language>("en");
  const isEmail = channel === "email";
  const name = CHANNEL_NAME[channel];

  async function draft() {
    setDrafting(true);
    try {
      const r = await api.post<{ subject: string | null; body: string; groundedOn: string[]; withheld: string | null }>("/api/draft", { leadId: lead.id, channel, language });
      setSubject(r.subject ?? ""); setBody(r.body); setGrounding({ groundedOn: r.groundedOn, withheld: r.withheld });
    } catch (err) {
      reportError("draft that", err);
    } finally {
      setDrafting(false);
    }
  }

  async function logSent() {
    setLogging(true);
    try {
      await activityApi.logTouch(lead.id, { channel: channel.toUpperCase(), direction: "OUTBOUND", outcome: "sent", note: isEmail ? (subject ? `Subject: ${subject}` : undefined) : body.slice(0, 2000) || undefined });
      toast.success(`${name} logged`, { description: "Recorded on the timeline. Nothing was sent by Signalroom." });
      router.refresh(); onClose();
    } catch (err) {
      reportError("log that", err);
    } finally {
      setLogging(false);
    }
  }

  const digits = recipient?.replace(/[^\d]/g, "") ?? "";
  // LinkedIn has no prefill link, so it opens the profile; copy the note first.
  const openHref = !recipient ? null : isEmail
    ? `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : channel === "whatsapp"
      ? `https://wa.me/${digits}?text=${encodeURIComponent(body)}`
      : /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(recipient) ? recipient : null;
  const appName = isEmail ? "mail app" : channel === "whatsapp" ? "WhatsApp" : "LinkedIn profile";

  return (
    <Dialog open onOpenChange={(o) => !o && !logging && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{name} {lead.name}</DialogTitle>
          <DialogDescription>
            Signalroom does not send this. Draft and review it here, send it from your own {isEmail ? "mail app" : channel === "whatsapp" ? "WhatsApp" : "LinkedIn"}, then log it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-2xs text-secondary">
            {recipient ? <>To: <span className="text-primary">{recipient}</span></> : `No unlocked ${isEmail ? "email address" : channel === "whatsapp" ? "WhatsApp or mobile number" : "LinkedIn profile"} for this lead. Reveal a contact first, or write the message and log it after sending another way.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" loading={drafting} onClick={draft}><Sparkles />Draft from this lead&apos;s evidence</Button>
            <select aria-label="Draft language" value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="h-7 rounded-md border border-border bg-surface px-1.5 text-2xs">
              {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="text-2xs text-muted">{language === "en" ? "Drafts in English unless you pick another language." : "Placeholders and figures stay as written."}</span>
          </div>
          {grounding ? (
            <p className="text-2xs text-muted">
              Drawn from: {grounding.groundedOn.join(", ") || "nothing reported"}.{grounding.withheld ? ` Held back: ${grounding.withheld}` : ""}
            </p>
          ) : null}
          {isEmail ? (
            <Field label="Subject" htmlFor="qa-subject"><Input id="qa-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} /></Field>
          ) : null}
          <Field label="Message" htmlFor="qa-body"><Textarea id="qa-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} /></Field>
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" disabled={!body} onClick={() => { void navigator.clipboard.writeText(isEmail && subject ? `${subject}\n\n${body}` : body); toast.success("Copied"); }}><Copy />Copy</Button>
          <div className="flex flex-wrap gap-2">
            {openHref ? <Button variant="secondary" size="sm" asChild><a href={openHref} target="_blank" rel="noopener noreferrer">Open {appName}</a></Button> : null}
            <Button variant="primary" size="sm" loading={logging} onClick={logSent}>Log as sent</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CALL_OUTCOMES: [string, string][] = [["connected", "Connected"], ["no_answer", "No answer"], ["voicemail", "Left voicemail"], ["wrong_number", "Wrong number"], ["meeting_agreed", "Agreed to meet"], ["not_interested", "Not interested"]];

function CallDialog({ lead, phone, onClose }: { lead: Lead; phone: string | null; onClose: () => void }) {
  const router = useRouter();
  const [outcome, setOutcome] = React.useState("connected");
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [opener, setOpener] = React.useState<{ body: string; groundedOn: string[]; withheld: string | null } | null>(null);
  const [drafting, setDrafting] = React.useState(false);
  async function draftOpener() {
    setDrafting(true);
    try { setOpener(await api.post<{ body: string; groundedOn: string[]; withheld: string | null }>("/api/draft", { leadId: lead.id, channel: "call" })); }
    catch (err) { reportError("draft an opener", err); } finally { setDrafting(false); }
  }
  async function submit() {
    setPending(true);
    try {
      const r = await activityApi.logTouch(lead.id, { channel: "PHONE", direction: "OUTBOUND", outcome, note: note.trim() || undefined });
      toast.success("Call logged", { description: r.sequencesStopped ? `${r.sequencesStopped} sequence${r.sequencesStopped === 1 ? "" : "s"} stopped because they engaged.` : "Recorded on the timeline." });
      router.refresh(); onClose();
    } catch (err) { reportError("log that call", err); } finally { setPending(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log a call with {lead.name}</DialogTitle>
          <DialogDescription>{phone ? <>Call <a className="underline" href={`tel:${phone}`}>{phone}</a> from your phone, then record how it went.</> : "No unlocked phone number. Record a call made another way."}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Button variant="ghost" size="sm" loading={drafting} onClick={() => void draftOpener()}><Sparkles />Draft an opener</Button>
          {opener ? (
            <div className="space-y-1 rounded bg-surface-sunken p-2 text-xs">
              <p className="whitespace-pre-wrap text-primary">{opener.body}</p>
              <p className="text-2xs text-muted">From: {opener.groundedOn.join(", ") || "nothing reported"}.{opener.withheld ? ` Held back: ${opener.withheld}` : ""}</p>
            </div>
          ) : null}
          <Field label="Outcome" htmlFor="qa-outcome">
            <select id="qa-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
              {CALL_OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Notes" htmlFor="qa-call-note"><Textarea id="qa-call-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="What was said, what happens next." /></Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={submit}>Log call</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReplyDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const router = useRouter();
  const [channel, setChannel] = React.useState("EMAIL");
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  async function submit() {
    setPending(true);
    try {
      const r = await activityApi.logTouch(lead.id, { channel, direction: "INBOUND", outcome: "replied", note: note.trim() || undefined });
      toast.success("Reply logged", { description: r.sequencesStopped ? `${r.sequencesStopped} sequence${r.sequencesStopped === 1 ? "" : "s"} stopped on reply.` : "Marked as replied." });
      router.refresh(); onClose();
    } catch (err) { reportError("log that reply", err); } finally { setPending(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log a reply from {lead.name}</DialogTitle>
          <DialogDescription>For a reply that arrived outside Signalroom. The lead is marked replied, and any sequence set to stop on reply stops.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="Where did they reply?" htmlFor="qa-reply-channel">
            <select id="qa-reply-channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
              {[["EMAIL", "Email"], ["WHATSAPP", "WhatsApp"], ["LINKEDIN", "LinkedIn"], ["PHONE", "Phone"], ["SMS", "SMS"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="What did they say?" htmlFor="qa-reply-note"><Textarea id="qa-reply-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={submit}>Log reply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MeetingDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = React.useState(`${lead.name} · ${lead.companyName}`);
  const [date, setDate] = React.useState("");
  const [time, setTime] = React.useState("11:00");
  const [minutes, setMinutes] = React.useState(30);
  const [location, setLocation] = React.useState("");
  const [meetingUrl, setMeetingUrl] = React.useState("");
  const [agenda, setAgenda] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const valid = title.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);

  async function submit() {
    setPending(true);
    try {
      const startsAt = new Date(`${date}T${time}:00`);
      await bookingsApi.create({
        leadId: lead.id, title: title.trim(), startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + minutes * 60_000).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(location.trim() ? { location: location.trim() } : {}), ...(meetingUrl.trim() ? { meetingUrl: meetingUrl.trim() } : {}), ...(agenda.trim() ? { agenda: agenda.trim() } : {}),
      });
      toast.success("Meeting booked", { description: "Recorded in Bookings. No calendar invite is sent unless a calendar is connected." });
      router.refresh(); onClose();
    } catch (err) { reportError("book that meeting", err); } finally { setPending(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Book a meeting with {lead.name}</DialogTitle>
          <DialogDescription>Recorded against this lead in Bookings, with a brief and outcome capture afterwards.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="Title" htmlFor="qa-m-title" required><Input id="qa-m-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Date" htmlFor="qa-m-date" required><Input id="qa-m-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Start" htmlFor="qa-m-time" required><Input id="qa-m-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            <Field label="Length" htmlFor="qa-m-len">
              <select id="qa-m-len" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
                {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </Field>
          </div>
          <Field label="Location" htmlFor="qa-m-loc"><Input id="qa-m-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder="Their office, or leave blank for online" /></Field>
          <Field label="Meeting link" htmlFor="qa-m-url"><Input id="qa-m-url" type="url" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} maxLength={500} placeholder="https://meet.google.com/…" /></Field>
          <Field label="Agenda" htmlFor="qa-m-agenda"><Textarea id="qa-m-agenda" rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} maxLength={5000} /></Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" size="sm" loading={pending} disabled={!valid} onClick={submit}>Book meeting</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
