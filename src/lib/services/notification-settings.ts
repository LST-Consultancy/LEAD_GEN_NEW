import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";

/**
 * §85 — notifications.
 *
 * There is no per-kind preference store, so this screen reports what actually
 * fires rather than offering switches that save nowhere. The useful thing it
 * can say is how noisy each kind has *been* for you — a kind you would want to
 * mute is one that has fired forty times this month, and that is knowable
 * without a preferences table.
 */

/** What each kind means and what raises it. Kept out of the enum, per `vocab`. */
export const NOTIFICATION_KIND: Record<
  string,
  { label: string; raisedBy: string; actionable: boolean }
> = {
  HOT_LEAD: {
    label: "Hot lead",
    raisedBy: "A lead's intent crosses into hot, usually from a fresh signal.",
    actionable: true,
  },
  NEW_REPLY: {
    label: "New reply",
    raisedBy: "Someone replies. This also stops any sequence they were in.",
    actionable: true,
  },
  LEAD_SIGNAL: {
    label: "Lead signal",
    raisedBy: "A watched phrase matches something about a lead you own.",
    actionable: true,
  },
  DEAL_RISK: {
    label: "Deal risk",
    raisedBy: "A deal goes quiet, loses its next step, or slips its close date.",
    actionable: true,
  },
  TASK_DUE: {
    label: "Task due",
    raisedBy: "A task you own reaches its due time.",
    actionable: true,
  },
  PROPOSAL_VIEWED: {
    label: "Proposal viewed",
    raisedBy: "A prospect opens a proposal. Your own team's views are excluded.",
    actionable: false,
  },
  PROPOSAL_ACCEPTED: {
    label: "Proposal accepted",
    raisedBy: "Someone accepts from the public link.",
    actionable: true,
  },
  PROPOSAL_DECLINED: {
    label: "Proposal declined",
    raisedBy: "Someone declines from the public link, with their reason where given.",
    actionable: true,
  },
  MEETING_BOOKED: {
    label: "Meeting booked",
    raisedBy: "A booking is recorded against a lead.",
    actionable: true,
  },
  AUTOPILOT_APPROVAL: {
    label: "Needs approval",
    raisedBy: "An agent held an action that needs a person to approve it.",
    actionable: true,
  },
  POINTS_LOW: {
    label: "Points low",
    raisedBy: "The balance falls far enough that reveals will start failing.",
    actionable: true,
  },
  INTEGRATION_ERROR: {
    label: "Integration error",
    raisedBy: "A webhook delivery or a provider call fails repeatedly.",
    actionable: true,
  },
};

export type NotificationKindStat = {
  kind: string;
  label: string;
  raisedBy: string;
  actionable: boolean;
  /** How many you have received in the window — the real measure of noise. */
  received: number;
  unread: number;
  lastAt: string | null;
};

const WINDOW_DAYS = 30;

export async function getNotificationSettings(ctx: AuthContext): Promise<{
  kinds: NotificationKindStat[];
  windowDays: number;
  totalReceived: number;
  totalUnread: number;
}> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const where = { workspaceId: ctx.workspaceId, userId: ctx.userId, createdAt: { gte: since } };

  const [grouped, unreadGrouped, latest] = await Promise.all([
    db.notification.groupBy({ by: ["kind"], where, _count: { _all: true } }),
    db.notification.groupBy({
      by: ["kind"],
      where: { ...where, readAt: null },
      _count: { _all: true },
    }),
    db.notification.groupBy({ by: ["kind"], where, _max: { createdAt: true } }),
  ]);

  const kinds = Object.keys(NOTIFICATION_KIND)
    .map((kind) => {
      const spec = NOTIFICATION_KIND[kind];
      const received = grouped.find((g) => g.kind === kind)?._count._all ?? 0;
      return {
        kind,
        label: spec.label,
        raisedBy: spec.raisedBy,
        actionable: spec.actionable,
        received,
        unread: unreadGrouped.find((g) => g.kind === kind)?._count._all ?? 0,
        lastAt: latest.find((g) => g.kind === kind)?._max.createdAt?.toISOString() ?? null,
      };
    })
    // Noisiest first: the whole point is to find what you would want to mute.
    .sort((a, b) => b.received - a.received || a.label.localeCompare(b.label));

  return {
    kinds,
    windowDays: WINDOW_DAYS,
    totalReceived: kinds.reduce((n, k) => n + k.received, 0),
    totalUnread: kinds.reduce((n, k) => n + k.unread, 0),
  };
}
