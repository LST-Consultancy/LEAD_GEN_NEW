"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Link2,
  MapPin,
  Sparkles,
  Users,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { needsOutcomeRecorded } from "@/lib/bookings/outcome";
import { BookingCardActions, NewMeetingButton } from "@/components/bookings/booking-dialog";
import { cn } from "@/lib/utils";
import { formatDateTime, formatInrCompact, formatNumber, formatRelative } from "@/lib/format";
import { TIER } from "@/lib/vocab";

type Booking = {
  id: string;
  title: string;
  state: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  durationMin: number;
  location: string | null;
  meetingUrl: string | null;
  recordedProvider: string | null;
  agenda: string | null;
  aiSummary: string | null;
  outcomes: unknown;
  hasOutcome: boolean;
  isPast: boolean;
  lead: {
    id: string;
    name: string;
    tier: string;
    intent: string;
    company: { id: string; name: string; industry: string | null } | null;
  } | null;
  deal: { id: string; title: string; valueInr: number; status: string } | null;
};

type Brief = {
  who: {
    name: string;
    title: string | null;
    company: string;
    industry: string | null;
    city: string | null;
    employeeCount: number | null;
    technologies: string[];
    tier: string;
    intent: string;
    score: number | null;
  } | null;
  whyThemNow: { dimension: string; points: number; label: string; detail: string | null }[];
  recentSignals: { title: string; type: string; at: string; source: string }[];
  committee: {
    name: string;
    role: string;
    influence: number;
    sentiment: string | null;
    confirmed: boolean;
  }[];
  openDeals: { id: string; title: string; valueInr: number; stage: string }[];
  proposals: { id: string; title: string; state: string; totalInr: number; viewCount: number }[];
  lastTheySaid: { body: string; at: string } | null;
  carriedOver: { openObjections: string[]; openCommitments: string[]; competitors: string[] };
  priorMeetings: { title: string; at: string; summary: string | null }[];
  completeness: { filled: number; of: number };
  thin: boolean;
};


const STATE_META: Record<string, { label: string; variant: "neutral" | "success" | "warning" | "danger" }> = {
  scheduled: { label: "Scheduled", variant: "neutral" },
  completed: { label: "Completed", variant: "success" },
  no_show: { label: "No show", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "danger" },
};

export function BookingsView({
  bookings,
  window: activeWindow,
  calendar,
  bookingUrl = null,
}: {
  bookings: Booking[];
  window: string;
  bookingUrl?: string | null;
  calendar: {
    configured: boolean;
    provider: string | null;
    notConfiguredMessage: string;
    providers: readonly { name: string; label: string; requires: string; gives: string }[];
  };
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const needsOutcome = bookings.filter(needsOutcomeRecorded);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-primary">Bookings</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-secondary">
            Meetings kept alongside the lead, so the brief that makes the call land and the outcome
            that moves the deal live in the same place.
          </p>
        </div>
        <NewMeetingButton bookingUrl={bookingUrl} />
      </div>

      <CalendarBanner calendar={calendar} />

      {needsOutcome.length > 0 ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          {needsOutcome.length === 1
            ? "One meeting has finished with no outcome recorded"
            : `${needsOutcome.length} meetings have finished with no outcome recorded`}
          . The objections and commitments captured there are what the next brief carries over.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {[
          ["upcoming", "Upcoming"],
          ["past", "Past"],
          ["all", "All"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/bookings?window=${key}`}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors duration-150",
              activeWindow === key
                ? "bg-surface-active font-medium text-primary"
                : "text-secondary hover:bg-surface-hover"
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      {bookings.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={CalendarClock}
              title={activeWindow === "upcoming" ? "Nothing coming up" : "No meetings here"}
              description="Recording a meeting here does not put it in your calendar — it gives the call a brief built from this lead's signals, committee and history, and a place to capture what came out of it."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {bookings.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              expanded={expanded === b.id}
              onToggle={() => setExpanded(expanded === b.id ? null : b.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CalendarBanner({
  calendar,
}: {
  calendar: {
    configured: boolean;
    provider: string | null;
    notConfiguredMessage: string;
    providers: readonly { name: string; label: string; requires: string; gives: string }[];
  };
}) {
  if (calendar.configured) {
    return (
      <div className="rounded-lg border border-success-border bg-success-subtle px-3 py-2 text-xs text-success-text">
        <Check className="mr-1 inline size-3" />
        Connected to <strong>{calendar.provider}</strong>. Meetings created here appear in your
        calendar and invites go out.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5">
      <p className="text-xs text-warning-text">
        <Link2 className="mr-1 inline size-3.5" />
        <strong>No calendar is connected.</strong> {calendar.notConfiguredMessage}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-2xs font-medium text-warning-text/90">
          What connecting one would add
        </summary>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {calendar.providers.map((p) => (
            <li key={p.name} className="rounded-md bg-surface/60 px-2 py-1.5">
              <p className="text-2xs font-semibold text-primary">{p.label}</p>
              <p className="mt-0.5 text-2xs text-secondary">{p.gives}</p>
              <p className="text-2xs text-muted">
                <strong>Needs:</strong> {p.requires}
              </p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function BookingCard({
  booking,
  expanded,
  onToggle,
}: {
  booking: Booking;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [summary, setSummary] = useState("");
  const [objections, setObjections] = useState("");
  const [commitments, setCommitments] = useState("");

  const meta = STATE_META[booking.state] ?? STATE_META.scheduled;

  const open = async () => {
    onToggle();
    if (!expanded && !brief) {
      setLoadingBrief(true);
      try {
        setBrief(await api.get<Brief>(`/api/bookings/${booking.id}/brief`));
      } catch {
        setMessage({ tone: "bad", text: "Could not load the brief." });
      } finally {
        setLoadingBrief(false);
      }
    }
  };

  const act = async (fn: () => Promise<{ note: string }>) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fn();
      setMessage({ tone: "ok", text: res.note });
      setCapturing(false);
      router.refresh();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "That did not work." });
    } finally {
      setBusy(false);
    }
  };

  const lines = (value: string) =>
    value
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => void open()}
          className="flex min-w-0 items-start gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted" />
          )}
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-1.5">
              <span className="truncate">{booking.title}</span>
              <Badge variant={meta.variant} size="sm">
                {meta.label}
              </Badge>
              {needsOutcomeRecorded(booking) ? (
                <Tooltip content="Nothing was captured from this meeting, so the next brief has nothing to carry over.">
                  <span className="cursor-help">
                    <Badge variant="warning" size="sm">
                      Outcome missing
                    </Badge>
                  </span>
                </Tooltip>
              ) : null}
            </CardTitle>
            <p className="mt-0.5 truncate text-2xs text-muted">
              {formatDateTime(booking.startsAt, booking.timezone)} · {booking.durationMin} min
              {booking.lead ? (
                <>
                  {" · "}
                  <Link href={`/leads/${booking.lead.id}`} className="hover:underline">
                    {booking.lead.name}
                  </Link>
                  {booking.lead.company ? ` · ${booking.lead.company.name}` : null}
                </>
              ) : null}
            </p>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          {booking.state === "scheduled" && !booking.isPast ? <BookingCardActions booking={booking} /> : null}
          {booking.lead ? (
            <Badge variant="neutral" size="sm">
              <span className={TIER[booking.lead.tier as "A"]?.chip}>Tier {booking.lead.tier}</span>
            </Badge>
          ) : null}
          {!booking.isPast ? (
            <span className="text-2xs text-secondary">{formatRelative(booking.startsAt)}</span>
          ) : null}
          {booking.meetingUrl ? (
            <Tooltip content="Open the meeting link recorded on this booking">
              <Button size="icon-xs" variant="ghost" asChild>
                <a href={booking.meetingUrl} target="_blank" rel="noreferrer" aria-label="Join">
                  <Video />
                </a>
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </CardHeader>

      {message ? (
        <div className="px-4 pb-2">
          <p
            className={cn(
              "rounded-md px-2.5 py-2 text-2xs",
              message.tone === "ok"
                ? "border border-info-border bg-info-subtle text-info-text"
                : "border border-danger-border bg-danger-subtle text-danger-text"
            )}
          >
            {message.text}
          </p>
        </div>
      ) : null}

      {expanded ? (
        <CardContent className="flex flex-col gap-3 pt-0">
          {booking.location ? (
            <p className="text-2xs text-secondary">
              <MapPin className="mr-0.5 inline size-2.5" />
              {booking.location}
            </p>
          ) : null}
          {booking.agenda ? (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted">Agenda</p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-secondary">{booking.agenda}</p>
            </div>
          ) : null}

          {loadingBrief ? (
            <p className="text-2xs text-muted">Building the brief…</p>
          ) : brief ? (
            <BriefPanel brief={brief} />
          ) : null}

          {booking.hasOutcome ? (
            <OutcomePanel booking={booking} />
          ) : needsOutcomeRecorded(booking) ? (
            capturing ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-sunken p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-muted">
                  What came out of it
                </p>
                <Input
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="One or two lines on what was discussed"
                  className="text-xs"
                />
                <textarea
                  value={objections}
                  onChange={(e) => setObjections(e.target.value)}
                  rows={2}
                  placeholder="Objections, one per line"
                  className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-primary placeholder:text-muted focus:border-accent focus:outline-none"
                />
                <textarea
                  value={commitments}
                  onChange={(e) => setCommitments(e.target.value)}
                  rows={2}
                  placeholder="What you committed to, one per line — each becomes a task"
                  className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-primary placeholder:text-muted focus:border-accent focus:outline-none"
                />
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="xs"
                    variant="primary"
                    disabled={
                      busy ||
                      (summary.trim().length === 0 &&
                        lines(objections).length === 0 &&
                        lines(commitments).length === 0)
                    }
                    onClick={() =>
                      void act(() =>
                        api.post(`/api/bookings/${booking.id}/outcome`, {
                          attended: true,
                          summary: summary || undefined,
                          objections: lines(objections),
                          commitments: lines(commitments),
                        })
                      )
                    }
                  >
                    <Check />
                    Save outcome
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        api.post(`/api/bookings/${booking.id}/outcome`, { attended: false })
                      )
                    }
                  >
                    <X />
                    They did not attend
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setCapturing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="xs" variant="primary" onClick={() => setCapturing(true)}>
                <Sparkles />
                Record what happened
              </Button>
            )
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

/**
 * The brief.
 *
 * Every line traces to a row: score evidence, signals, committee, deals, the
 * last inbound message, and outcomes from earlier meetings. There is no model
 * call here, which is why the completeness counter is meaningful — a thin
 * brief is thin because the data is thin, not because generation failed.
 */
function BriefPanel({ brief }: { brief: Brief }) {
  const { carriedOver } = brief;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-sunken p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted">Pre-call brief</p>
        <Tooltip content="Assembled from rows in this workspace — score evidence, signals, the buying committee, open deals and earlier meeting outcomes. No model involved, so each line is traceable.">
          <span className="cursor-help text-2xs text-muted">
            {brief.completeness.filled} of {brief.completeness.of} sections have data
          </span>
        </Tooltip>
      </div>

      {brief.thin ? (
        <p className="rounded-md bg-surface px-2 py-1.5 text-2xs text-secondary">
          <Info className="mr-0.5 inline size-2.5" />
          There is little to brief on yet. That is what the workspace holds — nothing has been
          invented to fill the gap.
        </p>
      ) : null}

      {brief.who ? (
        <div>
          <p className="text-xs font-medium text-primary">
            {brief.who.name}
            {brief.who.title ? <span className="text-secondary"> · {brief.who.title}</span> : null}
          </p>
          <p className="text-2xs text-muted">
            {[
              brief.who.company,
              brief.who.industry,
              brief.who.city,
              brief.who.employeeCount ? `${formatNumber(brief.who.employeeCount)} staff` : null,
              brief.who.score !== null ? `score ${brief.who.score}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {brief.who.technologies.length > 0 ? (
            <p className="mt-0.5 text-2xs text-muted">Runs: {brief.who.technologies.join(", ")}</p>
          ) : null}
        </div>
      ) : null}

      {brief.whyThemNow.length > 0 ? (
        <Section title="Why them, why now">
          <ul className="flex flex-col gap-0.5">
            {brief.whyThemNow.map((e, i) => (
              <li key={i} className="text-2xs text-secondary">
                <span className="tabular font-medium text-primary">+{e.points}</span>{" "}
                <span className="text-muted">{e.dimension}</span> — {e.label}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {brief.recentSignals.length > 0 ? (
        <Section title="Recent signals">
          <ul className="flex flex-col gap-0.5">
            {brief.recentSignals.map((s, i) => (
              <li key={i} className="text-2xs text-secondary">
                {s.title} <span className="text-muted">· {s.source}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {carriedOver.openObjections.length > 0 || carriedOver.openCommitments.length > 0 ? (
        <Section title="Carried over from last time">
          {carriedOver.openCommitments.length > 0 ? (
            <p className="text-2xs text-secondary">
              <strong className="text-primary">You said you would:</strong>{" "}
              {carriedOver.openCommitments.join("; ")}
            </p>
          ) : null}
          {carriedOver.openObjections.length > 0 ? (
            <p className="text-2xs text-secondary">
              <strong className="text-primary">They pushed back on:</strong>{" "}
              {carriedOver.openObjections.join("; ")}
            </p>
          ) : null}
          {carriedOver.competitors.length > 0 ? (
            <p className="text-2xs text-secondary">
              <strong className="text-primary">Also looking at:</strong>{" "}
              {carriedOver.competitors.join(", ")}
            </p>
          ) : null}
        </Section>
      ) : null}

      {brief.committee.length > 0 ? (
        <Section title="Who else matters">
          <ul className="flex flex-wrap gap-1.5">
            {brief.committee.map((c, i) => (
              <li
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-2xs text-secondary"
              >
                <Users className="size-2.5 text-muted" />
                {c.name}
                <span className="text-muted">{c.role.toLowerCase().replace(/_/g, " ")}</span>
                {!c.confirmed ? (
                  <Tooltip content="Inferred, not confirmed — treat the role as a guess.">
                    <span className="cursor-help text-muted">?</span>
                  </Tooltip>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {brief.openDeals.length > 0 ? (
        <Section title="Open deals">
          <ul className="flex flex-col gap-0.5">
            {brief.openDeals.map((d) => (
              <li key={d.id} className="text-2xs text-secondary">
                {d.title} · <span className="tabular">{formatInrCompact(d.valueInr)}</span> ·{" "}
                {d.stage}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {brief.proposals.length > 0 ? (
        <Section title="Proposals">
          <ul className="flex flex-col gap-0.5">
            {brief.proposals.map((p) => (
              <li key={p.id} className="text-2xs text-secondary">
                {p.title} · {p.state.toLowerCase()} ·{" "}
                <span className="tabular">{formatInrCompact(p.totalInr)}</span>
                {p.viewCount > 0 ? (
                  <span className="text-muted"> · opened {p.viewCount}×</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {brief.lastTheySaid ? (
        <Section title="The last thing they said">
          <p className="whitespace-pre-wrap rounded-md bg-surface px-2 py-1.5 text-2xs italic text-secondary">
            {brief.lastTheySaid.body}
          </p>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-2xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      {children}
    </div>
  );
}

function OutcomePanel({ booking }: { booking: Booking }) {
  const o = booking.outcomes as {
    attended?: boolean;
    objections?: string[];
    commitments?: string[];
    competitors?: string[];
    decisionTimeline?: string | null;
    nextStep?: string | null;
    recordedBy?: string;
    cancelled?: boolean;
    reason?: string;
  };

  if (o.cancelled) {
    return (
      <p className="rounded-md bg-surface-sunken px-2.5 py-2 text-2xs text-secondary">
        Cancelled — {o.reason}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-sunken p-3">
      <p className="text-2xs font-semibold uppercase tracking-wider text-muted">What happened</p>
      {o.attended === false ? (
        <p className="text-2xs text-warning-text">They did not attend.</p>
      ) : (
        <>
          {booking.aiSummary ? (
            <p className="text-xs text-secondary">{booking.aiSummary}</p>
          ) : null}
          {o.objections && o.objections.length > 0 ? (
            <p className="text-2xs text-secondary">
              <strong className="text-primary">Objections:</strong> {o.objections.join("; ")}
            </p>
          ) : null}
          {o.commitments && o.commitments.length > 0 ? (
            <p className="text-2xs text-secondary">
              <strong className="text-primary">Commitments:</strong> {o.commitments.join("; ")}
            </p>
          ) : null}
          {o.competitors && o.competitors.length > 0 ? (
            <p className="text-2xs text-secondary">
              <strong className="text-primary">Competitors:</strong> {o.competitors.join(", ")}
            </p>
          ) : null}
          {o.decisionTimeline ? (
            <p className="text-2xs text-secondary">
              <strong className="text-primary">Timeline:</strong> {o.decisionTimeline}
            </p>
          ) : null}
        </>
      )}
      {o.recordedBy ? (
        <p className="text-2xs text-muted">Recorded by {o.recordedBy}</p>
      ) : null}
    </div>
  );
}
