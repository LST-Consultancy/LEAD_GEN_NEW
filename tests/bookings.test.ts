import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import {
  listBookings,
  getBookingBrief,
  createBooking,
  recordBookingOutcome,
  cancelBooking,
  isCalendarConfigured,
  activeCalendarProvider,
  CALENDAR_PROVIDERS,
  type BookingInput,
} from "@/lib/services/bookings";
import { ForbiddenError } from "@/lib/auth/context";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Bookings");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

const HOUR = 3600_000;

function input(over: Partial<BookingInput> = {}): BookingInput {
  const start = new Date(Date.now() + 24 * HOUR);
  return {
    title: "Discovery call",
    startsAt: start,
    endsAt: new Date(start.getTime() + HOUR),
    timezone: "Asia/Kolkata",
    agenda: "Understand the current quoting process.",
    ...over,
  };
}

/** A booking that has already finished, so an outcome can be recorded. */
async function pastBooking(ctx: Parameters<typeof createBooking>[0], leadId?: string) {
  const start = new Date(Date.now() - 3 * HOUR);
  const booking = await db.booking.create({
    data: {
      workspaceId: ctx.workspaceId,
      leadId,
      hostUserId: ctx.userId,
      title: "Discovery call",
      state: "scheduled",
      startsAt: start,
      endsAt: new Date(start.getTime() + HOUR),
      timezone: "Asia/Kolkata",
    },
  });
  return booking;
}

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

/** Stated explicitly rather than inherited from the developer's `.env`. */
function withoutCalendar() {
  for (const key of ["GOOGLE_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_ID", "CALDAV_URL"]) {
    vi.stubEnv(key, "");
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("the calendar provider", () => {
  it("reports nothing connected when no credential is present", () => {
    withoutCalendar();
    expect(isCalendarConfigured()).toBe(false);
    expect(activeCalendarProvider()).toBeNull();
  });

  it("says what each option needs and gives", () => {
    for (const p of CALENDAR_PROVIDERS) {
      expect(p.requires.length).toBeGreaterThan(10);
      expect(p.gives.length).toBeGreaterThan(10);
    }
  });
});

describe("recording a meeting", () => {
  it("says plainly that nothing was scheduled or invited", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });

    const result = await createBooking(ctx, input({ leadId: lead.id }));
    expect(result.note).toMatch(/no invite was sent/i);
    expect(result.note).toMatch(/no event was created/);
  });

  it("leaves the provider null rather than implying an integration", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const result = await createBooking(ctx, input({ leadId: lead.id }));
    expect(result.booking.provider).toBeNull();
  });

  it("rejects a meeting that ends before it starts", async () => {
    const { ctx } = await freshWorkspace();
    const start = new Date(Date.now() + 24 * HOUR);
    await expect(
      createBooking(ctx, input({ startsAt: start, endsAt: new Date(start.getTime() - HOUR) }))
    ).rejects.toThrow();
  });

  it("rejects an implausibly long meeting", async () => {
    const { ctx } = await freshWorkspace();
    const start = new Date(Date.now() + 24 * HOUR);
    await expect(
      createBooking(ctx, input({ startsAt: start, endsAt: new Date(start.getTime() + 20 * HOUR) }))
    ).rejects.toThrow();
  });

  it("rejects a malformed meeting link", async () => {
    const { ctx } = await freshWorkspace();
    await expect(createBooking(ctx, input({ meetingUrl: "not-a-url" }))).rejects.toThrow();
  });

  it("warns about an overlap but records it anyway", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const start = new Date(Date.now() + 48 * HOUR);
    await createBooking(ctx, input({ leadId: lead.id, startsAt: start, endsAt: new Date(start.getTime() + HOUR) }));

    const second = await createBooking(
      ctx,
      input({
        title: "Overlapping call",
        startsAt: new Date(start.getTime() + 30 * 60_000),
        endsAt: new Date(start.getTime() + 90 * 60_000),
      })
    );
    expect(second.clash).toMatch(/already have/);
    // Recorded regardless — this app does not own the calendar.
    expect(second.booking.id).toBeTruthy();
  });

  it("reports no clash when there is none", async () => {
    const { ctx } = await freshWorkspace();
    const result = await createBooking(ctx, input());
    expect(result.clash).toBeNull();
  });

  it("refuses a lead the caller cannot see", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    await expect(createBooking(rep, input({ leadId: lead.id }))).rejects.toThrow(
      /don't have access/
    );
  });

  it("requires the pipeline permission", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const viewer = await addMember(workspace.id, "Viewer", "viewer");
    await expect(createBooking(viewer, input())).rejects.toThrow(ForbiddenError);
    void ctx;
  });
});

describe("listing", () => {
  it("separates upcoming from past", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await createBooking(ctx, input({ leadId: lead.id, title: "Future call" }));
    await pastBooking(ctx, lead.id);

    const upcoming = await listBookings(ctx, { window: "upcoming" });
    const past = await listBookings(ctx, { window: "past" });
    expect(upcoming.map((b) => b.title)).toEqual(["Future call"]);
    expect(past.map((b) => b.title)).toEqual(["Discovery call"]);
  });

  it("computes the duration rather than storing it", async () => {
    const { ctx } = await freshWorkspace();
    const start = new Date(Date.now() + 24 * HOUR);
    await createBooking(
      ctx,
      input({ startsAt: start, endsAt: new Date(start.getTime() + 45 * 60_000) })
    );
    const [b] = await listBookings(ctx);
    expect(b.durationMin).toBe(45);
  });

  it("distinguishes a recorded provider from a live integration", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const b = await pastBooking(ctx, lead.id);
    // A seeded or imported row can name a provider without one being connected.
    await db.booking.update({ where: { id: b.id }, data: { provider: "google" } });

    const [listed] = await listBookings(ctx, { window: "past" });
    expect(listed.recordedProvider).toBe("google");
    // And the app knows none is actually connected.
    withoutCalendar();
    expect(isCalendarConfigured()).toBe(false);
  });

  it("hides another rep's meeting from a rep", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await createBooking(ctx, input({ leadId: lead.id }));
    const rep = await addMember(workspace.id, "Rep", "sales_rep");

    expect(await listBookings(ctx)).toHaveLength(1);
    expect(await listBookings(rep)).toHaveLength(0);
  });

  it("excludes a cancelled meeting from upcoming", async () => {
    const { ctx } = await freshWorkspace();
    const { booking } = await createBooking(ctx, input());
    await cancelBooking(ctx, booking.id, "They postponed");
    expect(await listBookings(ctx, { window: "upcoming" })).toHaveLength(0);
  });
});

describe("recording an outcome", () => {
  it("refuses before the meeting has happened", async () => {
    const { ctx } = await freshWorkspace();
    const { booking } = await createBooking(ctx, input());
    await expect(
      recordBookingOutcome(ctx, booking.id, { attended: true, summary: "Went well" })
    ).rejects.toThrow(/has not happened yet/);
  });

  it("refuses an attended meeting with nothing captured", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const b = await pastBooking(ctx, lead.id);
    await expect(recordBookingOutcome(ctx, b.id, { attended: true })).rejects.toThrow(
      /same as not recording it/
    );
  });

  it("turns each commitment into a task", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const b = await pastBooking(ctx, lead.id);

    const result = await recordBookingOutcome(ctx, b.id, {
      attended: true,
      summary: "Good call.",
      commitments: ["Send indicative commercials", "Arrange a reference call"],
      objections: ["Price versus a larger integrator"],
    });

    expect(result.tasksCreated).toBe(2);
    expect(result.note).toMatch(/commitments became tasks/);

    const tasks = await db.task.findMany({
      where: { workspaceId: workspace.id, leadId: lead.id },
      orderBy: { title: "asc" },
    });
    expect(tasks.map((t) => t.title)).toEqual([
      "Arrange a reference call",
      "Send indicative commercials",
    ]);
    expect(tasks[0].priority).toBe("HIGH");
    expect(tasks[0].priorityReason).toMatch(/committed to this in a meeting/);
  });

  it("records a no-show as a no-show, not a completed meeting", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const b = await pastBooking(ctx, lead.id);

    const result = await recordBookingOutcome(ctx, b.id, { attended: false });
    expect(result.booking.state).toBe("no_show");
    expect(result.note).toMatch(/Nothing was captured as progress/);
    expect(result.tasksCreated).toBe(0);
  });

  it("refuses an outcome on a cancelled meeting", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const b = await pastBooking(ctx, lead.id);
    await cancelBooking(ctx, b.id, "They postponed");
    await expect(
      recordBookingOutcome(ctx, b.id, { attended: true, summary: "Happened anyway" })
    ).rejects.toThrow(/would contradict/);
  });

  it("accepts an outcome on a meeting already marked completed but never captured", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const b = await pastBooking(ctx, lead.id);
    // How a seeded or imported meeting arrives: completed, outcomes empty.
    await db.booking.update({ where: { id: b.id }, data: { state: "completed" } });

    const result = await recordBookingOutcome(ctx, b.id, {
      attended: true,
      summary: "Captured after the fact.",
      objections: ["Price"],
    });
    expect(result.booking.state).toBe("completed");

    const after = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect((after.outcomes as Record<string, unknown>).objections).toEqual(["Price"]);
  });

  it("stores who recorded it and when", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const b = await pastBooking(ctx, lead.id);
    await recordBookingOutcome(ctx, b.id, { attended: true, summary: "Good call." });

    const after = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    const outcomes = after.outcomes as Record<string, unknown>;
    expect(outcomes.recordedBy).toBe(ctx.user.name);
    expect(typeof outcomes.recordedAt).toBe("string");
  });
});

describe("cancelling", () => {
  it("requires a reason", async () => {
    const { ctx } = await freshWorkspace();
    const { booking } = await createBooking(ctx, input());
    await expect(cancelBooking(ctx, booking.id, "")).rejects.toThrow(/Record why/);
  });

  it("says nobody was notified when no calendar is connected", async () => {
    const { ctx } = await freshWorkspace();
    const { booking } = await createBooking(ctx, input());
    const result = await cancelBooking(ctx, booking.id, "They postponed");
    expect(result.note).toMatch(/nobody was notified/);
  });

  it("refuses to cancel a meeting that already has an outcome", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const b = await pastBooking(ctx, lead.id);
    await recordBookingOutcome(ctx, b.id, { attended: true, summary: "Happened." });
    await expect(cancelBooking(ctx, b.id, "Actually no")).rejects.toThrow(
      /already happened/
    );
  });
});

describe("the pre-call brief", () => {
  it("assembles from rows that exist, and reports how complete it is", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company, person } = await makeLead(workspace.id, {
      ownerId: ctx.userId,
      name: "Priya Menon",
    });

    // Real evidence on the score.
    const score = await db.leadScore.findFirstOrThrow({ where: { leadId: lead.id } });
    await db.leadScoreEvidence.create({
      data: {
        workspaceId: workspace.id,
        leadScoreId: score.id,
        dimension: "intent",
        points: 40,
        label: "Published a tender for ERP",
        sourceType: "signal",
      },
    });
    await db.signal.create({
      data: {
        workspaceId: workspace.id,
        leadId: lead.id,
        type: "RFP",
        sourceKind: "TENDER_PORTAL",
        sourceName: "State portal",
        title: "ERP modernisation tender",
        excerpt: "Notice published.",
        occurredAt: new Date(),
        dedupeHash: `t-${lead.id}`,
      },
    });
    await db.committeeMember.create({
      data: {
        workspaceId: workspace.id,
        companyId: company.id,
        personId: person.id,
        role: "DECISION_MAKER",
        influence: 80,
        confirmedAt: new Date(),
      },
    });

    const { booking } = await createBooking(ctx, input({ leadId: lead.id }));
    const brief = await getBookingBrief(ctx, booking.id);

    expect(brief?.who?.name).toBe("Priya Menon");
    expect(brief?.whyThemNow[0].label).toBe("Published a tender for ERP");
    expect(brief?.recentSignals[0].title).toBe("ERP modernisation tender");
    expect(brief?.committee[0]).toMatchObject({ role: "DECISION_MAKER", confirmed: true });
    expect(brief?.completeness.of).toBe(7);
    expect(brief?.completeness.filled).toBeGreaterThanOrEqual(4);
    expect(brief?.thin).toBe(false);
  });

  it("admits when a brief is thin rather than padding it", async () => {
    const { ctx, workspace } = await freshWorkspace();
    // No lead at all: nothing to brief on.
    const { booking } = await createBooking(ctx, input());
    const brief = await getBookingBrief(ctx, booking.id);
    expect(brief?.who).toBeNull();
    expect(brief?.thin).toBe(true);
    expect(brief?.completeness.filled).toBe(0);
    void workspace;
  });

  it("carries objections and commitments forward from earlier meetings", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });

    const earlier = await pastBooking(ctx, lead.id);
    await recordBookingOutcome(ctx, earlier.id, {
      attended: true,
      summary: "First call.",
      objections: ["Price versus a larger integrator"],
      commitments: ["Send indicative commercials"],
      competitors: ["Large systems integrator"],
    });

    const { booking } = await createBooking(ctx, input({ leadId: lead.id, title: "Second call" }));
    const brief = await getBookingBrief(ctx, booking.id);

    expect(brief?.carriedOver.openObjections).toContain("Price versus a larger integrator");
    expect(brief?.carriedOver.openCommitments).toContain("Send indicative commercials");
    expect(brief?.carriedOver.competitors).toContain("Large systems integrator");
    expect(brief?.priorMeetings[0].summary).toBe("First call.");
  });

  it("does not carry over from a meeting that happens after this one", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const past = await pastBooking(ctx, lead.id);
    await recordBookingOutcome(ctx, past.id, {
      attended: true,
      summary: "Earlier.",
      objections: ["Real objection"],
    });

    // A booking scheduled *before* the past one has nothing to carry.
    const early = await db.booking.create({
      data: {
        workspaceId: workspace.id,
        leadId: lead.id,
        hostUserId: ctx.userId,
        title: "Even earlier",
        state: "scheduled",
        startsAt: new Date(Date.now() - 10 * 24 * HOUR),
        endsAt: new Date(Date.now() - 10 * 24 * HOUR + HOUR),
      },
    });
    const brief = await getBookingBrief(ctx, early.id);
    expect(brief?.carriedOver.openObjections).toEqual([]);
  });

  it("includes the last thing the prospect said", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const conversation = await db.conversation.create({
      data: { workspaceId: workspace.id, channel: "EMAIL", leadId: lead.id, companyId: company.id },
    });
    await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        channel: "EMAIL",
        state: "REPLIED",
        body: "Send indicative commercials before we meet.",
      },
    });

    const { booking } = await createBooking(ctx, input({ leadId: lead.id }));
    const brief = await getBookingBrief(ctx, booking.id);
    expect(brief?.lastTheySaid?.body).toBe("Send indicative commercials before we meet.");
  });

  it("returns null across workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const { booking } = await createBooking(b.ctx, input());
    expect(await getBookingBrief(a.ctx, booking.id)).toBeNull();
    expect(await getBookingBrief(b.ctx, booking.id)).not.toBeNull();
  });
});
