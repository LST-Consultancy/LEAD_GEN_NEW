/**
 * The job catalogue.
 *
 * Deliberately free of any Redis, Prisma or `server-only` import so the web
 * app, the worker and the tests can all share one definition of what a job is
 * and what payload it carries.
 */

export const QUEUE_NAME = "signalroom";

/** Every job the system knows how to run. */
export const JOB = {
  /** Re-runs the scoring engine over a workspace's leads. */
  RESCORE_WORKSPACE: "rescore.workspace",
  /** Re-runs the scoring engine for one lead, e.g. after a new signal. */
  RESCORE_LEAD: "rescore.lead",
  /** Recomputes deal risk flags from stage dwell time and activity. */
  DETECT_DEAL_RISKS: "pipeline.detect_risks",
  /** Archives leads that have been inactive past the workspace's window. */
  ARCHIVE_STALE_LEADS: "leads.archive_stale",
  /** Permanently removes recycle-bin entries past their purge date. */
  PURGE_RECYCLE_BIN: "data.purge_recycle_bin",
  /** Recomputes the ranked next-best-action list for active leads. */
  REFRESH_NEXT_ACTIONS: "leads.refresh_next_actions",
  /** Rebuilds the worklist priority scores that Today and My Queue read. */
  RESCORE_WORKLIST: "tasks.rescore_worklist",
  /** Delivers one webhook event, with retries. */
  DELIVER_WEBHOOK: "webhook.deliver",
  /** Raises notifications for things that became urgent since the last run. */
  SWEEP_NOTIFICATIONS: "notifications.sweep",
  /** Sends one outbound message, re-checking sendability at send time. */
  SEND_MESSAGE: "outreach.send_message",
  /** Advances every due sequence enrollment by one step. */
  ADVANCE_SEQUENCES: "outreach.advance_sequences",
  /** Wakes conversations whose snooze has expired. */
  WAKE_SNOOZED: "inbox.wake_snoozed",
  /** Moves proposals past their validity date into EXPIRED. */
  EXPIRE_PROPOSALS: "proposals.expire",
  /** Verifies every live proposal's totals against its own line items. */
  AUDIT_PROPOSAL_TOTALS: "proposals.audit_totals",
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type JobPayloads = {
  [JOB.RESCORE_WORKSPACE]: { workspaceId: string; reason?: string };
  [JOB.RESCORE_LEAD]: { workspaceId: string; leadId: string; reason?: string };
  [JOB.DETECT_DEAL_RISKS]: { workspaceId: string };
  [JOB.ARCHIVE_STALE_LEADS]: { workspaceId: string };
  [JOB.PURGE_RECYCLE_BIN]: { workspaceId: string };
  [JOB.REFRESH_NEXT_ACTIONS]: { workspaceId: string; leadIds?: string[] };
  [JOB.RESCORE_WORKLIST]: { workspaceId: string };
  [JOB.DELIVER_WEBHOOK]: { workspaceId: string; deliveryId: string };
  [JOB.SWEEP_NOTIFICATIONS]: { workspaceId: string };
  [JOB.SEND_MESSAGE]: { messageId: string };
  [JOB.ADVANCE_SEQUENCES]: { workspaceId: string };
  [JOB.WAKE_SNOOZED]: { workspaceId: string };
  [JOB.EXPIRE_PROPOSALS]: { workspaceId: string };
  [JOB.AUDIT_PROPOSAL_TOTALS]: { workspaceId: string };
};

export type JobPayload<N extends JobName> = JobPayloads[N];

/** Per-job retry and backoff policy. */
export const JOB_POLICY: Record<
  JobName,
  { attempts: number; backoffMs: number; timeoutMs: number }
> = {
  [JOB.RESCORE_WORKSPACE]: { attempts: 3, backoffMs: 5_000, timeoutMs: 300_000 },
  [JOB.RESCORE_LEAD]: { attempts: 3, backoffMs: 2_000, timeoutMs: 30_000 },
  [JOB.DETECT_DEAL_RISKS]: { attempts: 3, backoffMs: 5_000, timeoutMs: 120_000 },
  [JOB.ARCHIVE_STALE_LEADS]: { attempts: 2, backoffMs: 10_000, timeoutMs: 120_000 },
  [JOB.PURGE_RECYCLE_BIN]: { attempts: 2, backoffMs: 10_000, timeoutMs: 120_000 },
  [JOB.REFRESH_NEXT_ACTIONS]: { attempts: 3, backoffMs: 5_000, timeoutMs: 180_000 },
  [JOB.RESCORE_WORKLIST]: { attempts: 3, backoffMs: 5_000, timeoutMs: 120_000 },
  // Webhook delivery retries hardest and longest — the receiver may be down.
  [JOB.DELIVER_WEBHOOK]: { attempts: 6, backoffMs: 30_000, timeoutMs: 30_000 },
  [JOB.SWEEP_NOTIFICATIONS]: { attempts: 2, backoffMs: 10_000, timeoutMs: 60_000 },
  // A send is retried, but not aggressively: the risk of a duplicate landing
  // in someone's mailbox is worse than the send being late.
  [JOB.SEND_MESSAGE]: { attempts: 3, backoffMs: 60_000, timeoutMs: 30_000 },
  [JOB.ADVANCE_SEQUENCES]: { attempts: 2, backoffMs: 30_000, timeoutMs: 180_000 },
  [JOB.WAKE_SNOOZED]: { attempts: 2, backoffMs: 10_000, timeoutMs: 30_000 },
  [JOB.EXPIRE_PROPOSALS]: { attempts: 2, backoffMs: 10_000, timeoutMs: 60_000 },
  [JOB.AUDIT_PROPOSAL_TOTALS]: { attempts: 2, backoffMs: 10_000, timeoutMs: 120_000 },
};

/**
 * Recurring schedules, in cron. Keyed by job so a redeploy replaces the
 * schedule rather than stacking a second copy of it.
 */
export const JOB_SCHEDULE: Partial<Record<JobName, { cron: string; describe: string }>> = {
  [JOB.DETECT_DEAL_RISKS]: {
    cron: "0 */2 * * *",
    describe: "Every two hours — risk flags should be fresh when someone opens the board.",
  },
  [JOB.RESCORE_WORKSPACE]: {
    cron: "30 1 * * *",
    describe: "Nightly at 01:30 — recency decay changes every score a little each day.",
  },
  [JOB.RESCORE_WORKLIST]: {
    cron: "0 * * * *",
    describe: "Hourly — the worklist ranks by deadline proximity, which moves constantly.",
  },
  [JOB.REFRESH_NEXT_ACTIONS]: {
    cron: "0 2 * * *",
    describe: "Nightly at 02:00, after rescoring.",
  },
  [JOB.ARCHIVE_STALE_LEADS]: {
    cron: "0 3 * * *",
    describe: "Nightly at 03:00.",
  },
  [JOB.PURGE_RECYCLE_BIN]: {
    cron: "30 3 * * *",
    describe: "Nightly at 03:30 — retention is a promise, so it runs on a schedule.",
  },
  [JOB.SWEEP_NOTIFICATIONS]: {
    cron: "*/15 * * * *",
    describe: "Every fifteen minutes.",
  },
  [JOB.ADVANCE_SEQUENCES]: {
    cron: "*/10 * * * *",
    describe:
      "Every ten minutes — fine enough that a step lands near its intended hour, coarse " +
      "enough that a whole workspace's sends do not leave at the same second.",
  },
  [JOB.WAKE_SNOOZED]: {
    cron: "*/5 * * * *",
    describe: "Every five minutes — a snooze that returns late is a missed follow-up.",
  },
  [JOB.EXPIRE_PROPOSALS]: {
    cron: "15 0 * * *",
    describe:
      "Just after local midnight — a proposal is valid for the whole of its last day, so it " +
      "expires when that day ends, not on a rolling 24-hour clock.",
  },
  [JOB.AUDIT_PROPOSAL_TOTALS]: {
    cron: "45 4 * * *",
    describe:
      "Nightly — a proposal whose total disagrees with its own line items is the worst thing " +
      "this product could show a customer, so it is checked rather than assumed.",
  },
};

/**
 * Which jobs a person may force from the monitor, and — for the rest — why
 * not. The reason is rendered where the button would be, so a missing control
 * reads as a decision rather than an omission (§126).
 *
 * This lives here rather than in the route and the view, which each had their
 * own copy of the list.
 */
export const MANUAL_TRIGGER: Record<JobName, { allowed: true } | { allowed: false; because: string }> =
  {
    [JOB.RESCORE_WORKSPACE]: { allowed: true },
    [JOB.DETECT_DEAL_RISKS]: { allowed: true },
    [JOB.RESCORE_WORKLIST]: { allowed: true },
    [JOB.REFRESH_NEXT_ACTIONS]: { allowed: true },
    [JOB.ARCHIVE_STALE_LEADS]: { allowed: true },
    [JOB.PURGE_RECYCLE_BIN]: { allowed: true },
    [JOB.SWEEP_NOTIFICATIONS]: { allowed: true },
    [JOB.WAKE_SNOOZED]: { allowed: true },
    [JOB.EXPIRE_PROPOSALS]: { allowed: true },
    [JOB.AUDIT_PROPOSAL_TOTALS]: { allowed: true },
    [JOB.RESCORE_LEAD]: {
      allowed: false,
      because: "Runs per lead, from the lead's own screen.",
    },
    [JOB.DELIVER_WEBHOOK]: {
      allowed: false,
      because: "Driven by events, not by a person deciding to fire one.",
    },
    [JOB.SEND_MESSAGE]: {
      allowed: false,
      because: "Sends one specific message; triggered when that message is queued.",
    },
    [JOB.ADVANCE_SEQUENCES]: {
      allowed: false,
      because:
        "This one sends real outbound. The ten-minute schedule is what paces it, so forcing a run would defeat the pacing.",
    },
  };

export const TRIGGERABLE_JOBS = (Object.keys(MANUAL_TRIGGER) as JobName[]).filter(
  (name) => MANUAL_TRIGGER[name].allowed
);

/** Human labels for the job monitor. */
export const JOB_LABEL: Record<JobName, string> = {
  [JOB.RESCORE_WORKSPACE]: "Rescore all leads",
  [JOB.RESCORE_LEAD]: "Rescore one lead",
  [JOB.DETECT_DEAL_RISKS]: "Detect deal risks",
  [JOB.ARCHIVE_STALE_LEADS]: "Archive stale leads",
  [JOB.PURGE_RECYCLE_BIN]: "Purge recycle bin",
  [JOB.REFRESH_NEXT_ACTIONS]: "Refresh next best actions",
  [JOB.RESCORE_WORKLIST]: "Re-rank worklist",
  [JOB.DELIVER_WEBHOOK]: "Deliver webhook",
  [JOB.SWEEP_NOTIFICATIONS]: "Sweep notifications",
  [JOB.SEND_MESSAGE]: "Send one message",
  [JOB.ADVANCE_SEQUENCES]: "Advance sequences",
  [JOB.WAKE_SNOOZED]: "Wake snoozed threads",
  [JOB.EXPIRE_PROPOSALS]: "Expire proposals",
  [JOB.AUDIT_PROPOSAL_TOTALS]: "Audit proposal totals",
};
