/**
 * Web Push: VAPID signing checked against a real P-256 verify, endpoint allowlisting, and delivery
 * that claims each notification once and drops subscriptions the push service reports gone.
 * `fetch` is stubbed, so no push service is contacted.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { validPushEndpoint, vapidAuthorization } from "@/lib/push/webpush";
import { deliverNotificationPushes, pushFeed, subscribePush } from "@/lib/services/push";
import { raiseNotification } from "@/lib/services/notify";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string; y: string };
const PUB = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
beforeEach(() => { vi.stubEnv("VAPID_PUBLIC_KEY", PUB); vi.stubEnv("VAPID_PRIVATE_KEY", jwk.d); vi.stubEnv("VAPID_SUBJECT", "mailto:ops@signalroom.example"); });
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

describe("VAPID and endpoints", () => {
  it("signs a JWT for the push service's origin that verifies with the public key", () => {
    const h = vapidAuthorization(ENDPOINT, { publicKey: PUB, privateKey: jwk.d, subject: "mailto:ops@signalroom.example" }, Date.UTC(2026, 8, 25));
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h)!;
    expect(k).toBe(PUB);
    const [head, body, sig] = token.split(".");
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:ops@signalroom.example" });
    expect(verify("sha256", Buffer.from(`${head}.${body}`), { key: createPublicKey(publicKey.export({ format: "pem", type: "spki" })), dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });
  it("accepts only real browser push services", () => {
    for (const ok of [ENDPOINT, "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QAb", "https://wns2-par02p.notify.windows.com/w/?token=x"]) expect(validPushEndpoint(ok)).not.toBeNull();
    for (const bad of ["http://fcm.googleapis.com/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com.evil.example/x", "https://127.0.0.1/x", "https://fcm.googleapis.com:8443/x"]) expect(validPushEndpoint(bad)).toBeNull();
  });
});

describe("delivery", () => {
  it("pushes once per person per run, never twice, carries no payload, and drops a gone subscription", async () => {
    const w = await makeWorkspace("Push"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const other = await makeWorkspace("PushOther"); created.workspaceIds.push(other.workspace.id); created.userIds.push(other.user.id); created.planIds.push(other.plan.id);
    await expect(subscribePush(w.ctx, { endpoint: "https://evil.example/x", keys: { p256dh: "p".repeat(20), auth: "a".repeat(16) } })).rejects.toThrow(/not a browser push service/);
    await subscribePush(w.ctx, { endpoint: ENDPOINT, keys: { p256dh: "p".repeat(20), auth: "a".repeat(16) } });
    await subscribePush(w.ctx, { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/gone", keys: { p256dh: "p".repeat(20), auth: "a".repeat(16) } });
    const kind = "TASK_DUE";
    await db.notificationPreference.create({ data: { workspaceId: w.workspace.id, userId: w.user.id, kind, push: true } });
    await raiseNotification({ data: { workspaceId: w.workspace.id, userId: w.user.id, kind, title: "Call Meera", body: "Due in 10 minutes", href: "/tasks" } });
    await raiseNotification({ data: { workspaceId: w.workspace.id, userId: w.user.id, kind, title: "Email Arjun", body: "Due now", href: "/tasks" } });
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => { calls.push({ url: String(url), init }); return new Response(null, { status: String(url).includes("gone") ? 410 : 201 }); }));
    expect(await deliverNotificationPushes(w.workspace.id)).toMatchObject({ pushed: 2, failed: 0 });
    // Two notifications, one wake-up per browser.
    expect(calls).toHaveLength(2);
    expect(calls.every(c => c.init.body === undefined && (c.init.headers as Record<string, string>)["Content-Length"] === "0")).toBe(true);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toMatch(/^vapid t=/);
    expect(await db.pushSubscription.findFirstOrThrow({ where: { workspaceId: w.workspace.id, endpoint: { contains: "gone" } } })).toMatchObject({ revokedAt: expect.any(Date) });
    // A redelivered job pushes nothing again.
    expect(await deliverNotificationPushes(w.workspace.id)).toMatchObject({ pushed: 0 });
    expect(calls).toHaveLength(2);
    // The worker reads the text over the person's own session; another workspace sees none of it.
    expect((await pushFeed(w.ctx)).notifications.map(n => n.title).sort()).toEqual(["Call Meera", "Email Arjun"]);
    expect((await pushFeed(other.ctx)).notifications).toEqual([]);
  });

  it("does nothing when push is not configured, and a preference with only push on still records the notification", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const w = await makeWorkspace("PushOff"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    await db.notificationPreference.create({ data: { workspaceId: w.workspace.id, userId: w.user.id, kind: "TASK_DUE", inApp: false, email: false, push: true } });
    expect(await raiseNotification({ data: { workspaceId: w.workspace.id, userId: w.user.id, kind: "TASK_DUE", title: "t", body: "b" } })).toBe(true);
    expect(await deliverNotificationPushes(w.workspace.id)).toMatchObject({ pushed: 0, skipped: expect.stringContaining("not configured") });
  });
});
