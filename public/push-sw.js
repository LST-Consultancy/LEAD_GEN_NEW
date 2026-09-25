/*
 * Signalroom push service worker. A push carries no content: on a wake-up it fetches the newest
 * unread notifications over the person's own session and shows them. Nothing else is cached or
 * intercepted — this worker has no fetch handler.
 */
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let items = [];
    try {
      const res = await fetch("/api/push/feed", { credentials: "same-origin", cache: "no-store" });
      if (res.ok) items = (await res.json()).notifications || [];
    } catch { /* offline or signed out: show a generic prompt below */ }
    if (!items.length) {
      await self.registration.showNotification("Signalroom", { body: "You have a new notification. Open Signalroom to see it.", tag: "signalroom", data: { href: "/notifications" } });
      return;
    }
    for (const n of items) await self.registration.showNotification(n.title, { body: n.body, tag: n.id, data: { href: n.href } });
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/notifications";
  event.waitUntil((async () => {
    const url = new URL(href, self.location.origin);
    if (url.origin !== self.location.origin) return;
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) if (new URL(c.url).origin === url.origin && "focus" in c) { await c.navigate(url.href); return c.focus(); }
    return self.clients.openWindow(url.href);
  })());
});
