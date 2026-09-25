import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { MutationError } from "./mutate";
import { recordAudit } from "./audit";
import { pushConfigured, sendPush, validPushEndpoint, vapidPublicKey } from "@/lib/push/webpush";

const WINDOW_MS = 60 * 60_000;

/** Whether push can work here, and how many of the caller's browsers are subscribed. */
export async function pushStatus(ctx: AuthContext) {
  const devices = await db.pushSubscription.count({ where: { workspaceId: ctx.workspaceId, userId: ctx.userId, revokedAt: null } });
  return { configured: pushConfigured(), publicKey: pushConfigured() ? vapidPublicKey() : null, devices };
}

const subscriptionSchema = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }), userAgent: z.string().max(300).optional() });

/** Saves this browser's subscription for the caller. The endpoint must belong to a real browser push service. */
export async function subscribePush(ctx: AuthContext, raw: unknown) {
  if (!pushConfigured()) throw new MutationError("Push notifications are not set up on this server: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are needed. Nothing was saved.", "not_configured", 422);
  const input = subscriptionSchema.parse(raw ?? {});
  if (!validPushEndpoint(input.endpoint)) throw new MutationError("That is not a browser push service address, so it was not saved.", "invalid_endpoint", 422);
  await db.pushSubscription.upsert({
    where: { workspaceId_endpoint: { workspaceId: ctx.workspaceId, endpoint: input.endpoint } },
    create: { workspaceId: ctx.workspaceId, userId: ctx.userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent ?? null },
    // A browser that changes hands (another person signs in on it) belongs to whoever subscribed it last.
    update: { userId: ctx.userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent ?? null, revokedAt: null, failures: 0, lastError: null },
  });
  await recordAudit(ctx, { action: "notifications.push_subscribed", objectType: "PushSubscription", after: { host: new URL(input.endpoint).hostname } });
  return pushStatus(ctx);
}

export async function unsubscribePush(ctx: AuthContext, raw: unknown) {
  const { endpoint } = z.object({ endpoint: z.string().url().max(2000) }).parse(raw ?? {});
  const { count } = await db.pushSubscription.updateMany({ where: { workspaceId: ctx.workspaceId, userId: ctx.userId, endpoint, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count) await recordAudit(ctx, { action: "notifications.push_unsubscribed", objectType: "PushSubscription" });
  return pushStatus(ctx);
}

/**
 * Wakes the browsers of people who asked for push on a kind. Each notification is claimed before
 * pushing, so a redelivered job never pushes twice; one older than an hour is not pushed late. A
 * subscription the push service reports gone is dropped.
 */
export async function deliverNotificationPushes(workspaceId: string, now = new Date()) {
  if (!pushConfigured()) return { pushed: 0, failed: 0, skipped: "Push is not configured on this server." };
  const prefs = await db.notificationPreference.findMany({ where: { workspaceId, push: true }, select: { userId: true, kind: true } });
  if (!prefs.length) return { pushed: 0, failed: 0, skipped: null };
  const due = await db.notification.findMany({ where: { workspaceId, pushClaimedAt: null, pushedAt: null, createdAt: { gte: new Date(now.getTime() - WINDOW_MS) }, OR: prefs.map(p => ({ userId: p.userId, kind: p.kind })) }, select: { id: true, userId: true }, take: 200, orderBy: { createdAt: "asc" } });
  let pushed = 0; let failed = 0;
  // One wake-up per person per run is enough: the worker shows everything new when it fetches.
  const byUser = new Map<string, string[]>();
  for (const n of due) {
    const { count } = await db.notification.updateMany({ where: { id: n.id, pushClaimedAt: null }, data: { pushClaimedAt: new Date() } });
    if (count) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n.id]);
  }
  for (const [userId, ids] of byUser) {
    const member = await db.workspaceMember.findFirst({ where: { workspaceId, userId, deletedAt: null }, select: { id: true } });
    const subs = member ? await db.pushSubscription.findMany({ where: { workspaceId, userId, revokedAt: null } }) : [];
    let any = false;
    for (const s of subs) {
      const r = await sendPush(s.endpoint);
      if (r.ok) { any = true; await db.pushSubscription.update({ where: { id: s.id }, data: { lastPushedAt: new Date(), failures: 0, lastError: null } }); continue; }
      await db.pushSubscription.update({ where: { id: s.id }, data: { failures: { increment: 1 }, lastError: r.reason.slice(0, 300), ...(r.gone ? { revokedAt: new Date() } : {}) } });
    }
    if (any) { pushed += ids.length; await db.notification.updateMany({ where: { id: { in: ids } }, data: { pushedAt: new Date() } }); }
    else failed += ids.length;
  }
  return { pushed, failed, skipped: null };
}

/** What the service worker shows after a wake-up: the caller's newest unread notifications. */
export async function pushFeed(ctx: AuthContext) {
  const rows = await db.notification.findMany({ where: { workspaceId: ctx.workspaceId, userId: ctx.userId, readAt: null, pushedAt: { gte: new Date(Date.now() - WINDOW_MS) } }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, title: true, body: true, href: true } });
  return { notifications: rows.map(r => ({ id: r.id, title: r.title, body: r.body.slice(0, 240), href: r.href && r.href.startsWith("/") ? r.href : "/notifications" })) };
}
