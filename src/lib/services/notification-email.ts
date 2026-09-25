import "server-only";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/outreach/transport";
import { canActuallySend } from "@/lib/outreach/provider";

const WINDOW_MS = 24 * 3600_000;
const appUrl = () => (process.env.APP_URL ?? "").replace(/\/+$/, "");
export const fromAddress = () => ({ email: process.env.EMAIL_FROM ?? "", name: process.env.EMAIL_FROM_NAME || "Signalroom" });

/**
 * Emails the notifications people asked to receive by email. Each is claimed before sending, so a
 * redelivered job or two workers never send one twice; one older than a day is not sent late.
 * With no working mail provider nothing is claimed, so they go out once one is connected — if
 * still inside the day.
 */
export async function deliverNotificationEmails(workspaceId: string, now = new Date()) {
  if (!canActuallySend() || !fromAddress().email.includes("@")) return { sent: 0, failed: 0, skipped: "No working email provider is configured on the server." };
  const prefs = await db.notificationPreference.findMany({ where: { workspaceId, email: true }, select: { userId: true, kind: true } });
  if (!prefs.length) return { sent: 0, failed: 0, skipped: null };
  const due = await db.notification.findMany({ where: { workspaceId, emailClaimedAt: null, emailedAt: null, createdAt: { gte: new Date(now.getTime() - WINDOW_MS) }, OR: prefs.map(p => ({ userId: p.userId, kind: p.kind })) }, include: { user: { select: { email: true, name: true, deletedAt: true } } }, take: 200, orderBy: { createdAt: "asc" } });
  let sent = 0; let failed = 0;
  for (const n of due) {
    const { count } = await db.notification.updateMany({ where: { id: n.id, emailClaimedAt: null }, data: { emailClaimedAt: new Date() } });
    if (!count) continue;
    const member = await db.workspaceMember.findFirst({ where: { workspaceId, userId: n.userId, deletedAt: null }, select: { id: true } });
    if (!member || n.user.deletedAt) { await db.notification.update({ where: { id: n.id }, data: { emailError: "Not a member of this workspace any more; not emailed." } }); continue; }
    const link = n.href && appUrl() ? `${appUrl()}${n.href.startsWith("/") ? n.href : `/${n.href}`}` : null;
    const outcome = await sendEmail({ from: fromAddress(), to: { email: n.user.email, name: n.user.name }, subject: n.title.slice(0, 200), text: `${n.body}\n\n${link ? `Open: ${link}\n\n` : ""}You get this because email is on for “${n.kind.replaceAll("_", " ").toLowerCase()}” notifications. Turn it off in Settings → Notifications.`, headers: { "Auto-Submitted": "auto-generated" } });
    if (outcome.ok) { sent++; await db.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } }); }
    else { failed++; await db.notification.update({ where: { id: n.id }, data: { emailError: outcome.reason.slice(0, 500) } }); }
  }
  return { sent, failed, skipped: null };
}
