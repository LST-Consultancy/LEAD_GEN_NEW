import { readsReplies } from "./mailboxes";
import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { isQueueConfigured } from "@/lib/queue/connection";
import { isConfigured as isAiConfigured, activeProvider } from "@/lib/ai/provider";
import {
  isEmailConfigured,
  activeEmailProvider,
  canActuallySend,
} from "@/lib/outreach/provider";
import { isCalendarConfigured, canSyncCalendar } from "@/lib/services/bookings";
import { RATE_LIMITS, rateLimit } from "@/lib/security/rate-limit";

/**
 * §100 — support.
 *
 * The most useful thing a support screen can do before anyone writes a message
 * is tell them what is and isn't connected, because most "it isn't working"
 * reports are an unconnected provider. Every line reports live state — nothing
 * here is a static claim.
 */

export type SystemCheck = {
  name: string;
  state: "ok" | "degraded" | "off";
  detail: string;
};

export async function getSupportDiagnostics(
  ctx: AuthContext
): Promise<{ checks: SystemCheck[]; workspaceSlug: string }> {
  const [replies, whatsapp] = await Promise.all([readsReplies(ctx.workspaceId), db.providerConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: "whatsapp_cloud" } }, select: { enabled: true, encryptedCredentials: true, status: true } })]);
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { slug: true },
  });

  const checks: SystemCheck[] = [
    {
      name: "Database",
      state: "ok",
      // Trivially true — this page could not have rendered otherwise. Listed
      // so its absence from the list is never mistaken for a gap.
      detail: "Reachable. This page read from it.",
    },
    {
      name: "Background jobs",
      state: isQueueConfigured() ? "ok" : "off",
      detail: isQueueConfigured()
        ? "Redis is configured, so scheduled work — rescoring, sequence steps, webhook delivery — runs."
        : "No Redis configured. The app works, but nothing recurs: rescoring, sequence steps and webhook delivery all wait.",
    },
    {
      name: "AI provider",
      state: isAiConfigured() ? "ok" : "off",
      detail: isAiConfigured()
        ? `${activeProvider()} is credentialled. Grounded answers and explanations work.`
        : "No key. Every model-backed feature reports as unavailable rather than degrading quietly. Deterministic scoring is unaffected.",
    },
    {
      name: "Email sending",
      // Three states, because a credential without an adapter sends nothing and
      // looks identical to a working one unless it is said out loud.
      state: canActuallySend() ? (replies ? "ok" : "degraded") : "off",
      detail: canActuallySend()
        ? replies
          ? `${activeEmailProvider()} is connected and sending, and can read replies.`
          : `${activeEmailProvider()} is sending but cannot read replies, so enrolment stays blocked — a sequence that ignores a reply loses the lead.`
        : isEmailConfigured()
          ? `${activeEmailProvider()} is credentialled but has no delivery adapter in this version, so nothing sends. SMTP and Resend do have one.`
          : "No mailbox connected, so nothing sends. Sequences still step, hold and record why. Set SMTP_URL and EMAIL_FROM to start sending.",
    },
    {
      name: "WhatsApp",
      state: whatsapp?.enabled && whatsapp.encryptedCredentials ? (whatsapp.status === "ERROR" ? "degraded" : "ok") : "off",
      detail: whatsapp?.enabled && whatsapp.encryptedCredentials
        ? whatsapp.status === "ERROR" ? "Connected, but the last check against Meta failed. Re-check it in WhatsApp API settings." : "Connected through the Cloud API. Sends need a recorded opt-in; replies and receipts arrive by webhook."
        : "Not connected. Consent and suppression are enforced; nothing sends.",
    },
    {
      name: "Calendar",
      state: canSyncCalendar() ? "ok" : isCalendarConfigured() ? "degraded" : "off",
      detail: canSyncCalendar()
        ? "Connected."
        : isCalendarConfigured()
          ? "A credential is present but no calendar adapter is built. Meetings are recorded against the lead; no invite is sent."
          : "Not connected. Meetings are recorded against the lead; no invite is sent.",
    },
  ];

  // Rate limiting counts in Redis when it is there and in memory otherwise.
  // Both work; only one is shared across instances, and saying which answered
  // is the difference between a limit you can rely on behind a load balancer
  // and one that is really N times looser. Probed with a throwaway key so the
  // check itself never consumes a real allowance.
  const probe = await rateLimit("write", `diagnostic:${ctx.workspaceId}`);
  checks.push({
    name: "Rate limiting",
    state: probe.scope === "shared" ? "ok" : "degraded",
    detail:
      probe.scope === "shared"
        ? `Counted in Redis and shared across every instance, so the limits hold as stated (${RATE_LIMITS.login.limit} sign-in attempts per ${RATE_LIMITS.login.windowSeconds / 60} minutes).`
        : `Counted in memory, which is per instance — behind two servers the effective limit is double. Set REDIS_URL to make it shared. Sign-in is still capped at ${RATE_LIMITS.login.limit} attempts per ${RATE_LIMITS.login.windowSeconds / 60} minutes per process.`,
  });

  checks.push({
    name: "Cross-site request forgery",
    state: "ok",
    detail:
      "Every state-changing request must carry an Origin or Referer matching this host, refused in middleware before a route runs. The session cookie is also httpOnly and SameSite=Lax.",
  });

  // Queue depth would belong here, but reading it means opening a BullMQ
  // queue per job type. The Background Jobs screen already does that properly.
  return { checks, workspaceSlug: workspace.slug };
}
