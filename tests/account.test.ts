import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, makeWorkspace, cleanup } from "./helpers/fixtures";
import { changePassword, revokeOtherSessions, revokeSession, updateProfile } from "@/lib/services/account";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
const OLD = "Original-Pass-2026";

async function signedIn() {
  const w = await makeWorkspace("Account");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  await db.user.update({ where: { id: w.user.id }, data: { passwordHash: await hashPassword(OLD) } });
  const mk = () => db.session.create({ data: { userId: w.user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) } });
  const current = await mk(); const other = await mk();
  return { ...w, ctx: { ...w.ctx, sessionId: current.id }, current, other };
}

describe("account self-service", () => {
  it("updates name, timezone and language, and rejects an unknown timezone", async () => {
    const w = await signedIn();
    await updateProfile(w.ctx, { name: "Renamed Person", timezone: "Europe/London", locale: "en-GB" });
    expect(await db.user.findUniqueOrThrow({ where: { id: w.user.id }, select: { name: true, timezone: true, locale: true } })).toEqual({ name: "Renamed Person", timezone: "Europe/London", locale: "en-GB" });
    await expect(updateProfile(w.ctx, { timezone: "Mars/Olympus" })).rejects.toThrow(/timezone/);
  });

  it("changes the password only with the current one, and signs out other sessions but not this one", async () => {
    const w = await signedIn();
    await expect(changePassword(w.ctx, { current: "wrong", next: "Brand-New-Pass-1", confirm: "Brand-New-Pass-1" })).rejects.toMatchObject({ code: "wrong_password" });
    await expect(changePassword(w.ctx, { current: OLD, next: "Brand-New-Pass-1", confirm: "Different-Pass-1" })).rejects.toMatchObject({ code: "mismatch" });
    await expect(changePassword(w.ctx, { current: OLD, next: "short", confirm: "short" })).rejects.toMatchObject({ code: "weak_password" });
    await expect(changePassword(w.ctx, { current: OLD, next: OLD, confirm: OLD })).rejects.toMatchObject({ code: "same_password" });
    const hashBefore = (await db.user.findUniqueOrThrow({ where: { id: w.user.id } })).passwordHash!;
    expect(await verifyPassword(OLD, hashBefore)).toBe(true);

    const r = await changePassword(w.ctx, { current: OLD, next: "Brand-New-Pass-1", confirm: "Brand-New-Pass-1" });
    expect(r.otherSessionsSignedOut).toBe(1);
    const hash = (await db.user.findUniqueOrThrow({ where: { id: w.user.id } })).passwordHash!;
    expect(await verifyPassword("Brand-New-Pass-1", hash)).toBe(true);
    expect((await db.session.findUniqueOrThrow({ where: { id: w.current.id } })).revokedAt).toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: w.other.id } })).revokedAt).not.toBeNull();
  });

  it("revokes only your own sessions", async () => {
    const a = await signedIn(); const b = await signedIn();
    await expect(revokeSession(a.ctx, b.other.id)).rejects.toMatchObject({ status: 404 });
    expect((await db.session.findUniqueOrThrow({ where: { id: b.other.id } })).revokedAt).toBeNull();
    await revokeSession(a.ctx, a.other.id);
    expect((await db.session.findUniqueOrThrow({ where: { id: a.other.id } })).revokedAt).not.toBeNull();
    const again = await signedIn();
    expect((await revokeOtherSessions(again.ctx)).count).toBe(1);
    expect((await db.session.findUniqueOrThrow({ where: { id: again.current.id } })).revokedAt).toBeNull();
  });
});
