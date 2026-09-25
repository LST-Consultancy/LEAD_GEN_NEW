import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/providers/http", async (original) => ({ ...(await original<typeof import("@/lib/providers/http")>()), providerJson: vi.fn() }));
import { providerJson } from "@/lib/providers/http";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { eventBody } from "@/lib/calendar/google";
import { completeGoogleConnect, readState, revokeCalendar, signState, startGoogleConnect } from "@/lib/services/calendar";
import { cancelBooking, createBooking, rescheduleBooking } from "@/lib/services/bookings";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.mocked(providerJson).mockReset();
  vi.stubEnv("PROVIDER_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("AUTH_SECRET", "s".repeat(40));
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret-synthetic");
});
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;
const SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy openid email";

describe("OAuth state and event bodies", () => {
  it("signs state, rejects tampering and expiry", () => {
    const s = signState({ workspaceId: "w", userId: "u", nonce: "n", exp: Date.now() + 60_000 });
    expect(readState(s)).toMatchObject({ userId: "u", nonce: "n" });
    expect(readState(`${s.split(".")[0]}.bad`)).toBeNull();
    expect(readState(signState({ workspaceId: "w", userId: "u", nonce: "n", exp: Date.now() - 1 }))).toBeNull();
  });
  it("builds a timed event with the link in the description", () => {
    expect(eventBody({ title: "Intro", startsAt: new Date("2026-10-01T05:30:00Z"), endsAt: new Date("2026-10-01T06:00:00Z"), timezone: "Asia/Kolkata", meetingUrl: "https://meet.example/x", attendees: ["a@b.example"] })).toMatchObject({ summary: "Intro", start: { timeZone: "Asia/Kolkata" }, attendees: [{ email: "a@b.example" }], description: expect.stringContaining("https://meet.example/x") });
  });
});

describe("Google Calendar end to end", () => {
  it("connects only from this browser, syncs create, move and cancel, invites only on request, and revokes", async () => {
    const w = await makeWorkspace("Calendar"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const company = await db.company.create({ data: { workspaceId: w.workspace.id, name: "Buyer Synthetic", country: "India" } });
    const person = await db.person.create({ data: { workspaceId: w.workspace.id, fullName: "Meera Synthetic", country: "India" } });
    await db.contactMethod.create({ data: { workspaceId: w.workspace.id, personId: person.id, kind: "WORK_EMAIL", value: "meera@buyer-synthetic.example", maskedValue: "m***@buyer-synthetic.example", isLocked: false, status: "UNVERIFIED", source: "manual" } });
    const lead = await db.lead.create({ data: { workspaceId: w.workspace.id, companyId: company.id, personId: person.id, ownerId: w.user.id, surfacedReason: "fixture" } });
    const redirectUri = "http://localhost:3000/api/calendar/google/callback";

    const { url, nonce } = startGoogleConnect(w.ctx, redirectUri);
    expect(new URL(url).searchParams.get("scope")).toContain("calendar.events");
    expect(new URL(url).searchParams.get("access_type")).toBe("offline");
    const state = new URL(url).searchParams.get("state")!;
    await expect(completeGoogleConnect(w.ctx, { code: "c", state, cookieNonce: "other-browser", redirectUri })).rejects.toThrow(/not started from this browser/);
    vi.mocked(providerJson).mockResolvedValueOnce({ access_token: "at-1", expires_in: 3600, refresh_token: "rt-1", scope: SCOPES, id_token: idToken("host@contoso-synthetic.example") } as never);
    expect(await completeGoogleConnect(w.ctx, { code: "c", state, cookieNonce: nonce, redirectUri })).toMatchObject({ email: "host@contoso-synthetic.example" });
    expect(vi.mocked(providerJson).mock.calls[0][5]).toMatchObject({ form: true });

    // Booked without an invite: an event, sendUpdates=none, no attendees.
    vi.mocked(providerJson).mockResolvedValueOnce({ id: "evt-1", htmlLink: "https://calendar.google.com/e/1" } as never);
    const start = new Date(Date.now() + 2 * 86400000);
    const b = await createBooking(w.ctx, { title: "Intro call", leadId: lead.id, startsAt: start, endsAt: new Date(start.getTime() + 1800_000), timezone: "Asia/Kolkata" });
    expect(b).toMatchObject({ calendarSynced: true, booking: { provider: "google", externalId: "evt-1" } });
    let call = vi.mocked(providerJson).mock.calls.at(-1)!;
    expect(String(call[2])).toContain("sendUpdates=none");
    expect((call[4] as { attendees: unknown[] }).attendees).toEqual([]);

    // With an invite: the lead's address, chosen by the recipient rules; sendUpdates=all.
    vi.mocked(providerJson).mockResolvedValueOnce({ id: "evt-2" } as never);
    const b2 = await createBooking(w.ctx, { title: "Demo", leadId: lead.id, startsAt: new Date(start.getTime() + 86400000), endsAt: new Date(start.getTime() + 86400000 + 1800_000), timezone: "Asia/Kolkata", invite: true });
    call = vi.mocked(providerJson).mock.calls.at(-1)!;
    expect(String(call[2])).toContain("sendUpdates=all");
    expect((call[4] as { attendees: { email: string }[] }).attendees).toEqual([{ email: "meera@buyer-synthetic.example" }]);
    expect(b2.note).toContain("was invited");

    // A suppressed address is never invited.
    await db.suppression.create({ data: { workspaceId: w.workspace.id, kind: "email", value: "meera@buyer-synthetic.example", reason: "asked", source: "manual" } });
    vi.mocked(providerJson).mockResolvedValueOnce({ id: "evt-3" } as never);
    const b3 = await createBooking(w.ctx, { title: "Follow-up", leadId: lead.id, startsAt: new Date(start.getTime() + 2 * 86400000), endsAt: new Date(start.getTime() + 2 * 86400000 + 1800_000), timezone: "Asia/Kolkata", invite: true });
    expect((vi.mocked(providerJson).mock.calls.at(-1)![4] as { attendees: unknown[] }).attendees).toEqual([]);
    expect(b3.note).toContain("cannot be invited");

    vi.mocked(providerJson).mockResolvedValueOnce({ id: "evt-1" } as never);
    const moved = await rescheduleBooking(w.ctx, (b.booking as { id: string }).id, { startsAt: new Date(start.getTime() + 3600_000), endsAt: new Date(start.getTime() + 5400_000) });
    expect(moved.note).toContain("calendar event was updated");
    expect(vi.mocked(providerJson).mock.calls.at(-1)![5]).toMatchObject({ method: "PATCH" });

    vi.mocked(providerJson).mockResolvedValueOnce({} as never);
    const cancelled = await cancelBooking(w.ctx, (b.booking as { id: string }).id, "They asked to postpone");
    expect(cancelled.note).toContain("event was removed");
    expect(vi.mocked(providerJson).mock.calls.at(-1)![5]).toMatchObject({ method: "DELETE" });

    // An expired token is refreshed before use, and the new one saved.
    const row = await db.calendarConnection.findFirstOrThrow({ where: { workspaceId: w.workspace.id } });
    const { encryptCredential } = await import("@/lib/providers/credentials");
    await db.calendarConnection.update({ where: { id: row.id }, data: { encryptedTokens: encryptCredential(JSON.stringify({ accessToken: "old", refreshToken: "rt-1", expiresAt: Date.now() - 1000, email: null }), w.workspace.id, "calendar") } });
    vi.mocked(providerJson).mockResolvedValueOnce({ access_token: "at-2", expires_in: 3600 } as never).mockResolvedValueOnce({ id: "evt-4" } as never);
    await createBooking(w.ctx, { title: "Check-in", startsAt: new Date(start.getTime() + 5 * 86400000), endsAt: new Date(start.getTime() + 5 * 86400000 + 1800_000), timezone: "Asia/Kolkata" });
    expect(vi.mocked(providerJson).mock.calls.at(-1)![3]).toMatchObject({ Authorization: "Bearer at-2" });

    vi.mocked(providerJson).mockResolvedValueOnce({} as never);
    expect((await revokeCalendar(w.ctx)).note).toContain("revoke access");
    expect(await db.calendarConnection.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ encryptedTokens: null, status: "REVOKED" });
    const after = await createBooking(w.ctx, { title: "Offline", startsAt: new Date(start.getTime() + 6 * 86400000), endsAt: new Date(start.getTime() + 6 * 86400000 + 1800_000), timezone: "Asia/Kolkata" });
    expect(after).toMatchObject({ calendarSynced: false, note: expect.stringContaining("no calendar connected") });
  });
});

describe("Microsoft 365 calendar end to end", () => {
  it("connects through Microsoft, creates an event with no attendees unless inviting, moves and cancels it, reads free/busy in UTC, and replaces a Google connection", async () => {
    vi.stubEnv("MICROSOFT_OAUTH_CLIENT_ID", "ms-client-synthetic");
    vi.stubEnv("MICROSOFT_OAUTH_CLIENT_SECRET", "ms-secret-synthetic");
    const { startMicrosoftConnect, completeMicrosoftConnect, calendarStatus, busyTimes } = await import("@/lib/services/calendar");
    const w = await makeWorkspace("CalendarMs"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const company = await db.company.create({ data: { workspaceId: w.workspace.id, name: "Buyer Synthetic", country: "India" } });
    const person = await db.person.create({ data: { workspaceId: w.workspace.id, fullName: "Meera Synthetic", country: "India" } });
    await db.contactMethod.create({ data: { workspaceId: w.workspace.id, personId: person.id, kind: "WORK_EMAIL", value: "meera@buyer-synthetic.example", maskedValue: "m***@buyer-synthetic.example", isLocked: false, status: "UNVERIFIED", source: "manual" } });
    const lead = await db.lead.create({ data: { workspaceId: w.workspace.id, companyId: company.id, personId: person.id, ownerId: w.user.id, surfacedReason: "fixture" } });
    // An existing Google connection is replaced: one calendar per person.
    await db.calendarConnection.create({ data: { workspaceId: w.workspace.id, userId: w.user.id, provider: "google", encryptedTokens: "x", scopes: [], status: "CONNECTED" } });
    const redirectUri = "http://localhost:3000/api/calendar/microsoft/callback";
    const { url, nonce } = startMicrosoftConnect(w.ctx, redirectUri);
    expect(new URL(url).hostname).toBe("login.microsoftonline.com");
    expect(new URL(url).searchParams.get("scope")).toContain("Calendars.ReadWrite");
    const state = new URL(url).searchParams.get("state")!;
    await expect(completeMicrosoftConnect(w.ctx, { code: "c", state, cookieNonce: "other", redirectUri })).rejects.toThrow(/not started from this browser/);
    vi.mocked(providerJson).mockResolvedValueOnce({ access_token: "ms-at", expires_in: 3600, refresh_token: "ms-rt", scope: "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read", id_token: idToken("host@contoso-synthetic.example") } as never);
    await completeMicrosoftConnect(w.ctx, { code: "c", state, cookieNonce: nonce, redirectUri });
    expect(await calendarStatus(w.ctx)).toMatchObject({ connected: true, provider: "microsoft", email: "host@contoso-synthetic.example" });
    expect(await db.calendarConnection.findFirstOrThrow({ where: { workspaceId: w.workspace.id, provider: "google" } })).toMatchObject({ status: "REVOKED", encryptedTokens: null });

    vi.mocked(providerJson).mockResolvedValueOnce({ id: "ms-evt-1", webLink: "https://outlook.office.com/e/1" } as never);
    const start = new Date(Date.now() + 2 * 86400000);
    const b = await createBooking(w.ctx, { title: "Intro call", leadId: lead.id, startsAt: start, endsAt: new Date(start.getTime() + 1800_000), timezone: "Asia/Kolkata" });
    expect(b).toMatchObject({ calendarSynced: true, booking: { provider: "microsoft", externalId: "ms-evt-1" } });
    let call = vi.mocked(providerJson).mock.calls.at(-1)!;
    expect(call[2]).toBe("https://graph.microsoft.com/v1.0/me/events");
    expect(call[4]).toMatchObject({ subject: "Intro call", attendees: [], start: { timeZone: "UTC", dateTime: start.toISOString().slice(0, 19) } });

    vi.mocked(providerJson).mockResolvedValueOnce({ id: "ms-evt-1" } as never);
    const later = new Date(start.getTime() + 86400000);
    await rescheduleBooking(w.ctx, b.booking.id, { startsAt: later, endsAt: new Date(later.getTime() + 1800_000) });
    call = vi.mocked(providerJson).mock.calls.at(-1)!;
    expect(call[2]).toContain("/me/events/ms-evt-1");
    expect(call[5]).toMatchObject({ method: "PATCH" });

    vi.mocked(providerJson).mockResolvedValueOnce({} as never);
    await cancelBooking(w.ctx, b.booking.id, "They asked to postpone");
    expect(vi.mocked(providerJson).mock.calls.at(-1)![5]).toMatchObject({ method: "DELETE" });

    vi.mocked(providerJson).mockResolvedValueOnce({ value: [{ scheduleItems: [{ status: "busy", start: { dateTime: "2026-10-01T05:30:00.0000000" }, end: { dateTime: "2026-10-01T06:00:00.0000000" } }, { status: "free", start: { dateTime: "2026-10-01T07:00:00" }, end: { dateTime: "2026-10-01T08:00:00" } }] }] } as never);
    const busy = await busyTimes(w.ctx, { from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" });
    expect(busy).toMatchObject({ connected: true, busy: [{ start: "2026-10-01T05:30:00.000Z", end: "2026-10-01T06:00:00.000Z" }] });

    // Microsoft has no per-app revoke endpoint: tokens are erased here and the note says where to remove the grant.
    const before = vi.mocked(providerJson).mock.calls.length;
    expect((await revokeCalendar(w.ctx)).note).toContain("myaccount.microsoft.com");
    expect(vi.mocked(providerJson).mock.calls.length).toBe(before);
  });
});
