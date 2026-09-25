import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { cancelBooking, canSyncCalendar, createBooking, rescheduleBooking } from "@/lib/services/bookings";
import { createDeal } from "@/lib/services/deal-mutations";
import { updateWorkspaceSettings } from "@/lib/services/workspace-settings";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
async function workspace() {
  const w = await makeWorkspace("Bookings2");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  const pipeline = await db.pipeline.create({ data: { workspaceId: w.workspace.id, name: "Sales", isDefault: true } });
  await db.pipelineStage.create({ data: { workspaceId: w.workspace.id, pipelineId: pipeline.id, key: "q", name: "Qualified", probability: 20, sortOrder: 0 } });
  return w;
}
const HOUR = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * HOUR);

describe("honest calendar notes", () => {
  it("a Gmail/Google credential does not make a booking claim calendar sync", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "gmail-sending-client");
    // The server can now connect calendars, but only a host who connected theirs gets events.
    expect(canSyncCalendar()).toBe(true);
    const w = await workspace();
    const r = await createBooking(w.ctx, { title: "Discovery", startsAt: at(24), endsAt: at(25) });
    expect(r.calendarSynced).toBe(false);
    expect(r.note).toMatch(/no event was created and no invite was sent/);
    const c = await cancelBooking(w.ctx, r.booking.id, "They asked to postpone");
    expect(c.note).toMatch(/nobody was notified/);
  });
});

describe("rescheduling", () => {
  it("moves a scheduled meeting and records the old time", async () => {
    const w = await workspace();
    const { booking } = await createBooking(w.ctx, { title: "Demo", startsAt: at(24), endsAt: at(25) });
    await expect(rescheduleBooking(w.ctx, booking.id, { startsAt: at(50), endsAt: at(49) })).rejects.toThrow(/ends before it starts/);
    const r = await rescheduleBooking(w.ctx, booking.id, { startsAt: at(48), endsAt: at(49), reason: "Their CFO is travelling" });
    expect(r.note).toMatch(/nobody was told/);
    const row = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.startsAt.getTime()).toBeCloseTo(at(48).getTime(), -4);
    const audit = await db.auditLog.findFirstOrThrow({ where: { objectId: booking.id, action: "booking.rescheduled" } });
    expect(JSON.stringify(audit.before)).toContain(new Date(booking.startsAt as unknown as string).toISOString());
  });

  it("refuses to move a cancelled meeting", async () => {
    const w = await workspace();
    const { booking } = await createBooking(w.ctx, { title: "Demo", startsAt: at(24), endsAt: at(25) });
    await cancelBooking(w.ctx, booking.id, "Went quiet");
    await expect(rescheduleBooking(w.ctx, booking.id, { startsAt: at(48), endsAt: at(49) })).rejects.toMatchObject({ code: "not_scheduled" });
  });

  it("a rep cannot move a colleague's meeting", async () => {
    const w = await workspace();
    const rep = await addMember(w.workspace.id, "BookRep", "sales_rep"); created.userIds.push(rep.userId);
    const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const { booking } = await createBooking(w.ctx, { title: "Owner's call", leadId: lead.id, startsAt: at(24), endsAt: at(25) });
    await expect(rescheduleBooking(rep, booking.id, { startsAt: at(48), endsAt: at(49) })).rejects.toMatchObject({ status: 404 });
  });
});

describe("booking links", () => {
  it("refuses another workspace's deal and a deal for a different lead", async () => {
    const w = await workspace(); const other = await workspace();
    const theirs = await makeLead(other.workspace.id, { ownerId: other.user.id });
    const foreignDeal = (await createDeal(other.ctx, { leadId: theirs.lead.id, valueInr: 1000 }) as { id: string }).id;
    await expect(createBooking(w.ctx, { title: "Intro call", dealId: foreignDeal, startsAt: at(24), endsAt: at(25) })).rejects.toMatchObject({ status: 404 });
    const a = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const b = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const bDeal = (await createDeal(w.ctx, { leadId: b.lead.id, valueInr: 1000 }) as { id: string }).id;
    await expect(createBooking(w.ctx, { title: "Intro call", leadId: a.lead.id, dealId: bDeal, startsAt: at(24), endsAt: at(25) })).rejects.toMatchObject({ code: "deal_lead_mismatch" });
  });

  it("stores an https booking URL, rejects anything else, and clears on empty", async () => {
    const w = await workspace();
    await expect(updateWorkspaceSettings(w.ctx, { bookingUrl: "cal.com/me" })).rejects.toThrow();
    await expect(updateWorkspaceSettings(w.ctx, { bookingUrl: "http://cal.com/me" })).rejects.toThrow();
    await updateWorkspaceSettings(w.ctx, { bookingUrl: "https://cal.com/lst/30min" });
    expect((await db.workspace.findUniqueOrThrow({ where: { id: w.workspace.id } })).bookingUrl).toBe("https://cal.com/lst/30min");
    await updateWorkspaceSettings(w.ctx, { bookingUrl: "" });
    expect((await db.workspace.findUniqueOrThrow({ where: { id: w.workspace.id } })).bookingUrl).toBeNull();
  });
});
