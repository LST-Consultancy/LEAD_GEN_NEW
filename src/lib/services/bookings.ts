import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, dealVisibilityFilter, leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate } from "@/lib/services/mutate";
import { localDateKey } from "@/lib/proposals/money";
import { emitWebhookEvent } from "@/lib/services/webhook-events";

/**
 * Meetings.
 *
 * With no calendar connected, this app does not *schedule* anything: it does
 * not create an event, send an invite or hold a slot. What it does is record a
 * meeting that exists elsewhere, and — the part that needs no integration —
 * assemble the brief that makes the call land, from rows this workspace
 * already holds.
 *
 * That split is stated everywhere it matters, because "Book a meeting" that
 * quietly writes a database row and sends nothing is exactly the kind of
 * button §126 forbids.
 */

export const CALENDAR_PROVIDERS = [
  {
    name: "google",
    label: "Google Calendar",
    requires: "OAuth consent for the Calendar API with events scope.",
    gives: "Two-way sync, invites sent from your own calendar, and free/busy for real availability.",
  },
  {
    name: "microsoft",
    label: "Outlook Calendar",
    requires: "An Entra ID app registration with Calendars.ReadWrite.",
    gives: "The same, for Microsoft accounts.",
  },
  {
    name: "caldav",
    label: "CalDAV",
    requires: "A CalDAV endpoint, username and app password.",
    gives: "Event creation on self-hosted or other standards-compliant calendars.",
  },
] as const;

export function activeCalendarProvider(): string | null {
  const configured = {
    google: process.env.GOOGLE_OAUTH_CLIENT_ID,
    microsoft: process.env.MICROSOFT_OAUTH_CLIENT_ID,
    caldav: process.env.CALDAV_URL,
  };
  const found = Object.entries(configured).find(([, v]) => v && v.length > 0);
  return found ? found[0] : null;
}

export function isCalendarConfigured(): boolean {
  return activeCalendarProvider() !== null;
}

/**
 * Whether a calendar adapter exists to act on that credential. None does. The
 * Google client id is also Gmail's sending credential, so connecting Gmail made
 * every booking say "synced to your calendar" and every cancellation say "the
 * calendar event was removed" while nothing touched a calendar.
 */
export const CALENDAR_ADAPTER_BUILT: Record<string, boolean> = { google: false, microsoft: false, caldav: false };

export function canSyncCalendar(): boolean {
  const active = activeCalendarProvider();
  return active !== null && CALENDAR_ADAPTER_BUILT[active] === true;
}

export const CALENDAR_NOT_CONFIGURED =
  "No calendar is connected, so nothing here creates an event or sends an invite. Meetings are " +
  "recorded against the lead so the brief, the outcome and the pipeline stay in one place — you " +
  "arrange the meeting itself in your own calendar.";

function visibility(ctx: AuthContext) {
  const filter = leadVisibilityFilter(ctx);
  if (!filter.ownerId) return {};
  return {
    OR: [{ lead: { ownerId: filter.ownerId } }, { leadId: null, hostUserId: filter.ownerId }],
  };
}

const bookingSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    leadId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    timezone: z.string().trim().min(1).default("Asia/Kolkata"),
    location: z.string().trim().max(300).optional(),
    meetingUrl: z.string().trim().url("That does not look like a meeting link.").max(500).optional(),
    agenda: z.string().trim().max(5000).optional(),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: "The meeting ends before it starts.",
    path: ["endsAt"],
  })
  .refine((v) => v.endsAt.getTime() - v.startsAt.getTime() <= 8 * 3600_000, {
    message: "A meeting longer than eight hours is almost certainly a mistake.",
    path: ["endsAt"],
  });

export type BookingInput = z.input<typeof bookingSchema>;

export async function listBookings(
  ctx: AuthContext,
  opts: { window?: "upcoming" | "past" | "all" } = {}
) {
  const window = opts.window ?? "upcoming";
  const now = new Date();

  const rows = await db.booking.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...visibility(ctx),
      ...(window === "upcoming"
        ? { startsAt: { gte: now }, state: { not: "cancelled" } }
        : window === "past"
          ? { startsAt: { lt: now } }
          : {}),
    },
    orderBy: window === "past" ? { startsAt: "desc" } : { startsAt: "asc" },
    take: 100,
    include: {
      lead: {
        select: {
          id: true,
          tier: true,
          intent: true,
          person: { select: { fullName: true, avatarUrl: true } },
          company: { select: { id: true, name: true, industry: true } },
        },
      },
      deal: { select: { id: true, title: true, valueInr: true, status: true } },
    },
  });

  return rows.map((b) => ({
    id: b.id,
    title: b.title,
    state: b.state,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    timezone: b.timezone,
    durationMin: Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000),
    location: b.location,
    meetingUrl: b.meetingUrl,
    /**
     * The provider recorded against this row, which is *not* evidence of a
     * live integration — a seeded or imported booking can name one. The UI
     * pairs it with whether a provider is actually connected.
     */
    recordedProvider: b.provider,
    agenda: b.agenda,
    aiSummary: b.aiSummary,
    hasBrief: Object.keys(b.briefJson as Record<string, unknown>).length > 0,
    outcomes: b.outcomes,
    hasOutcome: Object.keys(b.outcomes as Record<string, unknown>).length > 0,
    isPast: b.endsAt < now,
    lead: b.lead
      ? {
          id: b.lead.id,
          name: b.lead.person.fullName,
          avatarUrl: b.lead.person.avatarUrl,
          tier: b.lead.tier,
          intent: b.lead.intent,
          company: b.lead.company,
        }
      : null,
    deal: b.deal ? toPlain(b.deal) : null,
  }));
}

/**
 * The pre-call brief.
 *
 * Assembled entirely from rows that already exist — signals, score evidence,
 * the buying committee, open deals, prior meeting outcomes and the last thing
 * said in a thread. No model call, so every line is traceable to a record, and
 * a brief that would be thin says it is thin rather than padding itself out.
 */
export async function getBookingBrief(ctx: AuthContext, id: string) {
  const booking = await db.booking.findFirst({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null, ...visibility(ctx) },
    include: {
      lead: {
        select: {
          id: true,
          tier: true,
          intent: true,
          status: true,
          repliedAt: true,
          lastContactedAt: true,
          person: {
            select: {
              fullName: true,
              employments: { where: { isCurrent: true }, select: { title: true }, take: 1 },
            },
          },
          company: {
            select: {
              id: true,
              name: true,
              industry: true,
              city: true,
              employeeCount: true,
              technologies: true,
            },
          },
          score: {
            select: {
              displayScore: true,
              evidence: { orderBy: { points: "desc" }, take: 6 },
            },
          },
          signals: {
            orderBy: { occurredAt: "desc" },
            take: 5,
            select: { title: true, type: true, occurredAt: true, sourceName: true },
          },
          deals: {
            where: { deletedAt: null, status: "OPEN" },
            select: { id: true, title: true, valueInr: true, stage: { select: { name: true } } },
          },
          conversations: {
            where: { deletedAt: null },
            orderBy: { lastMessageAt: "desc" },
            take: 1,
            select: {
              messages: {
                where: { deletedAt: null, direction: "INBOUND" },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { body: true, createdAt: true },
              },
            },
          },
          proposals: {
            where: { deletedAt: null },
            orderBy: { updatedAt: "desc" },
            take: 2,
            select: { id: true, title: true, state: true, totalInr: true, viewCount: true },
          },
        },
      },
    },
  });

  if (!booking) return null;
  const lead = booking.lead;

  const committee = lead?.company
    ? await db.committeeMember.findMany({
        where: { workspaceId: ctx.workspaceId, companyId: lead.company.id },
        orderBy: { influence: "desc" },
        take: 6,
        select: {
          role: true,
          influence: true,
          sentiment: true,
          confirmedAt: true,
          person: { select: { fullName: true } },
        },
      })
    : [];

  // Outcomes from earlier meetings with the same lead — the objections and
  // commitments that are still open are the most useful thing on a brief.
  const priorMeetings = lead
    ? await db.booking.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          leadId: lead.id,
          id: { not: id },
          endsAt: { lt: booking.startsAt },
          deletedAt: null,
        },
        orderBy: { startsAt: "desc" },
        take: 3,
        select: { title: true, startsAt: true, outcomes: true, aiSummary: true },
      })
    : [];

  const priorOutcomes = priorMeetings
    .map((m) => m.outcomes as Record<string, unknown>)
    .filter((o) => o && Object.keys(o).length > 0);

  const openObjections = [
    ...new Set(priorOutcomes.flatMap((o) => (Array.isArray(o.objections) ? (o.objections as string[]) : []))),
  ];
  const openCommitments = [
    ...new Set(priorOutcomes.flatMap((o) => (Array.isArray(o.commitments) ? (o.commitments as string[]) : []))),
  ];
  const competitors = [
    ...new Set(priorOutcomes.flatMap((o) => (Array.isArray(o.competitors) ? (o.competitors as string[]) : []))),
  ];

  const lastInbound = lead?.conversations[0]?.messages[0] ?? null;

  const sections = {
    who: lead
      ? {
          name: lead.person.fullName,
          title: lead.person.employments[0]?.title ?? null,
          company: lead.company.name,
          industry: lead.company.industry,
          city: lead.company.city,
          employeeCount: lead.company.employeeCount,
          technologies: lead.company.technologies,
          tier: lead.tier,
          intent: lead.intent,
          score: lead.score ? Number(lead.score.displayScore) : null,
        }
      : null,
    whyThemNow: (lead?.score?.evidence ?? []).map((e) => ({
      dimension: e.dimension,
      points: e.points,
      label: e.label,
      detail: e.detail,
    })),
    recentSignals: (lead?.signals ?? []).map((s) => ({
      title: s.title,
      type: s.type,
      at: s.occurredAt.toISOString(),
      source: s.sourceName,
    })),
    committee: committee.map((c) => ({
      name: c.person.fullName,
      role: c.role,
      influence: c.influence,
      sentiment: c.sentiment,
      // Whether a person is confirmed or inferred changes how you treat them
      // in the room, so it is on the brief rather than flattened away.
      confirmed: c.confirmedAt !== null,
    })),
    openDeals: (lead?.deals ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      valueInr: Number(d.valueInr),
      stage: d.stage.name,
    })),
    proposals: (lead?.proposals ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      state: p.state,
      totalInr: Number(p.totalInr),
      viewCount: p.viewCount,
    })),
    lastTheySaid: lastInbound
      ? { body: lastInbound.body.slice(0, 600), at: lastInbound.createdAt.toISOString() }
      : null,
    carriedOver: { openObjections, openCommitments, competitors },
    priorMeetings: priorMeetings.map((m) => ({
      title: m.title,
      at: m.startsAt.toISOString(),
      summary: m.aiSummary,
    })),
  };

  // Count what the brief actually has, so a thin brief admits it.
  const filled = [
    sections.who !== null,
    sections.whyThemNow.length > 0,
    sections.recentSignals.length > 0,
    sections.committee.length > 0,
    sections.openDeals.length > 0,
    sections.lastTheySaid !== null,
    openObjections.length > 0 || openCommitments.length > 0,
  ].filter(Boolean).length;

  return {
    booking: {
      id: booking.id,
      title: booking.title,
      state: booking.state,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      timezone: booking.timezone,
      agenda: booking.agenda,
      meetingUrl: booking.meetingUrl,
      outcomes: booking.outcomes,
    },
    ...sections,
    /** Out of seven possible sections. Shown so a sparse brief is obvious. */
    completeness: { filled, of: 7 },
    thin: filled <= 2,
  };
}

export async function createBooking(ctx: AuthContext, raw: BookingInput) {
  const input = bookingSchema.parse(raw);

  if (input.leadId) {
    await loadScoped(
      () =>
        db.lead.findFirst({
          where: {
            id: input.leadId,
            workspaceId: ctx.workspaceId,
            deletedAt: null,
            ...leadVisibilityFilter(ctx),
          },
          select: { id: true },
        }),
      "That lead"
    );
  }

  if (input.dealId) {
    const deal = await loadScoped(
      () => db.deal.findFirst({ where: { id: input.dealId, workspaceId: ctx.workspaceId, deletedAt: null, ...dealVisibilityFilter(ctx) }, select: { leadId: true } }),
      "That deal"
    );
    if (input.leadId && deal.leadId && deal.leadId !== input.leadId) {
      throw new MutationError("That deal belongs to a different lead from this meeting.", "deal_lead_mismatch", 422);
    }
  }

  // Warn about a clash rather than blocking it: double-booking is sometimes
  // deliberate, and this app is not the source of truth for the calendar.
  const clash = await db.booking.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      hostUserId: ctx.userId,
      deletedAt: null,
      state: { not: "cancelled" },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
    select: { id: true, title: true, startsAt: true },
  });

  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const booking = await db.booking.create({
      data: {
        workspaceId: ctx.workspaceId,
        leadId: input.leadId,
        dealId: input.dealId,
        hostUserId: ctx.userId,
        title: input.title,
        state: "scheduled",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: input.timezone,
        location: input.location,
        meetingUrl: input.meetingUrl,
        agenda: input.agenda,
        // Left null deliberately: no provider created this, and naming one
        // would imply a calendar event exists.
        provider: null,
      },
    });
    await emitWebhookEvent(ctx.workspaceId, "meeting.booked", { bookingId: booking.id, leadId: booking.leadId, dealId: booking.dealId, startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString(), timezone: booking.timezone });

    return {
      result: {
        booking: toPlain(booking),
        clash: clash
          ? `You already have "${clash.title}" overlapping this slot. Recorded anyway — this app does not own your calendar.`
          : null,
        note: canSyncCalendar()
          ? "Recorded and synced to your calendar."
          : "Recorded against the lead. No invite was sent and no calendar event was created — arrange the meeting itself in your own calendar.",
      },
      log: {
        action: "booking.created",
        objectType: "Booking",
        objectId: booking.id,
        after: {
          title: input.title,
          startsAt: input.startsAt.toISOString(),
          calendarSynced: canSyncCalendar(),
        },
        activity: {
          kind: "booking.created",
          summary: `Meeting recorded: ${input.title} on ${localDateKey(input.startsAt, input.timezone)}`,
          leadId: input.leadId,
        },
      },
    };
  });
}

const outcomeSchema = z.object({
  attended: z.boolean(),
  summary: z.string().trim().max(5000).optional(),
  objections: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  commitments: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  competitors: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  decisionTimeline: z.string().trim().max(200).optional(),
  nextStep: z.string().trim().max(300).optional(),
});

/**
 * Recording what happened.
 *
 * The outcome is the whole point of having the meeting in the app: objections
 * and commitments captured here are what the *next* brief carries over. A
 * no-show is recorded as such rather than as a completed meeting with nothing
 * in it.
 */
export async function recordBookingOutcome(
  ctx: AuthContext,
  id: string,
  raw: z.input<typeof outcomeSchema>
) {
  const input = outcomeSchema.parse(raw);

  const booking = await loadScoped(
    () =>
      db.booking.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null, ...visibility(ctx) },
        include: { lead: { select: { id: true, person: { select: { fullName: true } } } } },
      }),
    "That meeting"
  );

  if (booking.startsAt > new Date()) {
    throw new MutationError(
      "This meeting has not happened yet, so there is no outcome to record.",
      "not_yet",
      422
    );
  }
  if (booking.state === "cancelled") {
    throw new MutationError(
      "This meeting was cancelled. Recording an outcome against it would contradict that.",
      "cancelled",
      409
    );
  }

  if (input.attended && !input.summary && input.objections.length === 0 && input.commitments.length === 0) {
    throw new MutationError(
      "Record at least a summary, an objection or a commitment — an attended meeting with nothing captured is the same as not recording it.",
      "nothing_captured",
      422
    );
  }

  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const updated = await db.booking.update({
      where: { id },
      data: {
        state: input.attended ? "completed" : "no_show",
        aiSummary: input.summary ?? null,
        outcomes: {
          attended: input.attended,
          objections: input.objections,
          commitments: input.commitments,
          competitors: input.competitors,
          decisionTimeline: input.decisionTimeline ?? null,
          nextStep: input.nextStep ?? null,
          recordedBy: ctx.user.name,
          recordedAt: new Date().toISOString(),
        },
      },
    });

    // A commitment made in a meeting is a task, or it is forgotten.
    let tasksCreated = 0;
    for (const commitment of input.commitments) {
      await db.task.create({
        data: {
          workspaceId: ctx.workspaceId,
          title: commitment,
          description: `Committed during "${booking.title}".`,
          leadId: booking.leadId,
          dealId: booking.dealId,
          ownerId: ctx.userId,
          dueAt: new Date(Date.now() + 2 * 86_400_000),
          priority: "HIGH",
          priorityReason: "You committed to this in a meeting.",
        },
      });
      tasksCreated += 1;
    }

    return {
      result: {
        booking: toPlain(updated),
        tasksCreated,
        note: input.attended
          ? tasksCreated > 0
            ? `Recorded. ${tasksCreated} ${tasksCreated === 1 ? "commitment became a task" : "commitments became tasks"} due in two days, and the objections carry into the next brief.`
            : "Recorded, and the objections carry into the next brief for this lead."
          : "Recorded as a no-show. Nothing was captured as progress.",
      },
      log: {
        action: input.attended ? "booking.completed" : "booking.no_show",
        objectType: "Booking",
        objectId: id,
        before: { state: booking.state },
        after: {
          state: updated.state,
          objections: input.objections.length,
          commitments: input.commitments.length,
        },
        activity: {
          kind: input.attended ? "booking.completed" : "booking.no_show",
          summary: input.attended
            ? `Met ${booking.lead?.person.fullName ?? "a contact"}: ${input.summary?.slice(0, 120) ?? `${input.objections.length} objections, ${input.commitments.length} commitments`}`
            : `${booking.lead?.person.fullName ?? "A contact"} did not attend ${booking.title}`,
          leadId: booking.leadId ?? undefined,
        },
      },
    };
  });
}

const rescheduleSchema = z
  .object({ startsAt: z.coerce.date(), endsAt: z.coerce.date(), timezone: z.string().trim().min(1).optional(), reason: z.string().trim().max(300).optional() })
  .refine((v) => v.endsAt > v.startsAt, { message: "The meeting ends before it starts.", path: ["endsAt"] })
  .refine((v) => v.endsAt.getTime() - v.startsAt.getTime() <= 8 * 3600_000, { message: "A meeting longer than eight hours is almost certainly a mistake.", path: ["endsAt"] });

/** Moves a scheduled meeting. The old time is kept on the audit and activity rows. */
export async function rescheduleBooking(ctx: AuthContext, id: string, raw: z.input<typeof rescheduleSchema>) {
  const input = rescheduleSchema.parse(raw);
  const booking = await loadScoped(
    () => db.booking.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null, ...visibility(ctx) } }),
    "That meeting"
  );
  if (booking.state !== "scheduled") {
    throw new MutationError(`This meeting is ${booking.state}, so there is nothing to move. Book a new one instead.`, "not_scheduled", 409);
  }
  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const updated = await db.booking.update({ where: { id }, data: { startsAt: input.startsAt, endsAt: input.endsAt, ...(input.timezone ? { timezone: input.timezone } : {}) } });
    return {
      result: {
        booking: toPlain(updated),
        note: canSyncCalendar() ? "Moved, and the calendar event was updated." : "Moved here. No calendar is connected, so nobody was told — let them know yourself.",
      },
      log: {
        action: "booking.rescheduled", objectType: "Booking", objectId: id,
        before: { startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString() },
        after: { startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), reason: input.reason ?? null },
        activity: { kind: "booking.rescheduled", summary: `Moved ${booking.title} to ${localDateKey(input.startsAt, input.timezone ?? booking.timezone)}${input.reason ? ` — ${input.reason}` : ""}`, leadId: booking.leadId ?? undefined },
      },
    };
  });
}

export async function cancelBooking(ctx: AuthContext, id: string, reason: string) {
  if (reason.trim().length < 3) {
    throw new MutationError("Record why it was cancelled.", "reason_required", 422);
  }

  const booking = await loadScoped(
    () =>
      db.booking.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null, ...visibility(ctx) },
        include: { lead: { select: { id: true, person: { select: { fullName: true } } } } },
      }),
    "That meeting"
  );

  if (booking.state === "completed") {
    throw new MutationError(
      "This meeting already happened and has an outcome recorded. Cancelling it now would contradict the record.",
      "already_completed",
      409
    );
  }

  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const updated = await db.booking.update({
      where: { id },
      data: {
        state: "cancelled",
        outcomes: { cancelled: true, reason, cancelledBy: ctx.user.name, at: new Date().toISOString() },
      },
    });

    return {
      result: {
        booking: toPlain(updated),
        note: canSyncCalendar()
          ? "Cancelled, and the calendar event was removed."
          : "Cancelled here. No calendar is connected, so nobody was notified — tell them yourself.",
      },
      log: {
        action: "booking.cancelled",
        objectType: "Booking",
        objectId: id,
        before: { state: booking.state },
        after: { state: "cancelled", reason },
        activity: {
          kind: "booking.cancelled",
          summary: `Cancelled ${booking.title}: ${reason}`,
          leadId: booking.leadId ?? undefined,
        },
      },
    };
  });
}
