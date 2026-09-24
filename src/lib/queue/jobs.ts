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
  OPPORTUNITY_ACTION: "opportunity.action",
  OPPORTUNITY_DISCOVERY: "opportunity.discovery",
  OPPORTUNITY_WATCHES: "opportunity.watches",
  OPPORTUNITY_ENRICHMENT: "opportunity.enrichment",
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
  /** Re-queues webhook deliveries recorded while the queue was unreachable. */
  REQUEUE_WEBHOOKS: "webhook.requeue_stranded",
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
  /** Writes each rep's Today sales-coach tip from their own send/reply history. */
  GENERATE_COACH_TIPS: "insights.generate_coach_tips",
  /** Writes each rep's Today "start here" recommendation from the day's counted facts. */
  GENERATE_DAILY_BRIEFS: "insights.generate_daily_briefs",
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type JobPayloads = {
  [JOB.OPPORTUNITY_ACTION]: { workspaceId: string; userId: string; opportunityId: string; syncId: string; operation: "enrich" | "verify" | "research" };
  [JOB.OPPORTUNITY_DISCOVERY]: { workspaceId: string; searchId: string };
  [JOB.OPPORTUNITY_WATCHES]: { workspaceId: string };
  [JOB.OPPORTUNITY_ENRICHMENT]: { workspaceId: string; runId: string };
  [JOB.RESCORE_WORKSPACE]: { workspaceId: string; reason?: string };
  [JOB.RESCORE_LEAD]: { workspaceId: string; leadId: string; reason?: string };
  [JOB.DETECT_DEAL_RISKS]: { workspaceId: string };
  [JOB.ARCHIVE_STALE_LEADS]: { workspaceId: string };
  [JOB.PURGE_RECYCLE_BIN]: { workspaceId: string };
  [JOB.REFRESH_NEXT_ACTIONS]: { workspaceId: string; leadIds?: string[] };
  [JOB.RESCORE_WORKLIST]: { workspaceId: string };
  [JOB.DELIVER_WEBHOOK]: { workspaceId: string; deliveryId: string };
  [JOB.SWEEP_NOTIFICATIONS]: { workspaceId: string };
  [JOB.REQUEUE_WEBHOOKS]: { workspaceId: string };
  [JOB.SEND_MESSAGE]: { messageId: string };
  [JOB.ADVANCE_SEQUENCES]: { workspaceId: string };
  [JOB.WAKE_SNOOZED]: { workspaceId: string };
  [JOB.EXPIRE_PROPOSALS]: { workspaceId: string };
  [JOB.AUDIT_PROPOSAL_TOTALS]: { workspaceId: string };
  [JOB.GENERATE_COACH_TIPS]: { workspaceId: string };
  [JOB.GENERATE_DAILY_BRIEFS]: { workspaceId: string };
};

export type JobPayload<N extends JobName> = JobPayloads[N];

/** Per-job retry and backoff policy. */
export const JOB_POLICY: Record<
  JobName,
  { attempts: number; backoffMs: number; timeoutMs: number }
> = {
  [JOB.OPPORTUNITY_ACTION]: { attempts: 2, backoffMs: 10000, timeoutMs: 300000 },
  [JOB.OPPORTUNITY_DISCOVERY]: { attempts: 3, backoffMs: 10000, timeoutMs: 900000 },
  [JOB.OPPORTUNITY_WATCHES]: { attempts: 3, backoffMs: 10000, timeoutMs: 120000 },
  // A redelivery resumes at the first unfinished stage and re-reads recorded Apify runs, so retrying is not re-buying.
  [JOB.OPPORTUNITY_ENRICHMENT]: { attempts: 2, backoffMs: 15000, timeoutMs: 1500000 },
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
  [JOB.REQUEUE_WEBHOOKS]: { attempts: 2, backoffMs: 30_000, timeoutMs: 60_000 },
  // A send is retried, but not aggressively: the risk of a duplicate landing
  // in someone's mailbox is worse than the send being late.
  [JOB.SEND_MESSAGE]: { attempts: 3, backoffMs: 60_000, timeoutMs: 30_000 },
  [JOB.ADVANCE_SEQUENCES]: { attempts: 2, backoffMs: 30_000, timeoutMs: 180_000 },
  [JOB.WAKE_SNOOZED]: { attempts: 2, backoffMs: 10_000, timeoutMs: 30_000 },
  [JOB.EXPIRE_PROPOSALS]: { attempts: 2, backoffMs: 10_000, timeoutMs: 60_000 },
  [JOB.AUDIT_PROPOSAL_TOTALS]: { attempts: 2, backoffMs: 10_000, timeoutMs: 120_000 },
  // One model call per rep with real send history, not per workspace, so this
  // needs more room than a single-call AI job.
  [JOB.GENERATE_COACH_TIPS]: { attempts: 2, backoffMs: 30_000, timeoutMs: 300_000 },
  [JOB.GENERATE_DAILY_BRIEFS]: { attempts: 2, backoffMs: 30_000, timeoutMs: 300_000 },
};

/**
 * Recurring schedules, in cron. Keyed by job so a redeploy replaces the
 * schedule rather than stacking a second copy of it.
 */
export const JOB_SCHEDULE: Partial<Record<JobName, { cron: string; describe: string }>> = {
  [JOB.OPPORTUNITY_WATCHES]: { cron: "15 * * * *", describe: "Hourly — enqueue due saved opportunity searches without overlapping cadence windows." },
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
  [JOB.REQUEUE_WEBHOOKS]: {
    cron: "7,37 * * * *",
    describe: "Twice an hour — a receiver learns of an event late rather than never after a queue outage.",
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
  [JOB.GENERATE_COACH_TIPS]: {
    cron: "0 5 * * *",
    describe:
      "Daily at 05:00, after rescoring and next-actions — the comparison should reflect " +
      "yesterday's real sends, not last week's.",
  },
  [JOB.GENERATE_DAILY_BRIEFS]: {
    cron: "5 5 * * *",
    describe: "Daily at 05:05, just after coach tips — both read the same overnight state.",
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
    [JOB.OPPORTUNITY_ACTION]: { allowed: false, because: "Requested after reviewing an opportunity." },
    [JOB.OPPORTUNITY_DISCOVERY]: { allowed: false, because: "Started from Find Opportunities." },
    [JOB.OPPORTUNITY_WATCHES]: { allowed: true },
    [JOB.OPPORTUNITY_ENRICHMENT]: { allowed: false, because: "Started from an opportunity's Research, Find people, Find emails, Check emails or Enrich buttons." },
    [JOB.RESCORE_WORKSPACE]: { allowed: true },
    [JOB.DETECT_DEAL_RISKS]: { allowed: true },
    [JOB.RESCORE_WORKLIST]: { allowed: true },
    [JOB.REFRESH_NEXT_ACTIONS]: { allowed: true },
    [JOB.ARCHIVE_STALE_LEADS]: { allowed: true },
    [JOB.PURGE_RECYCLE_BIN]: { allowed: true },
    [JOB.SWEEP_NOTIFICATIONS]: { allowed: true },
    [JOB.REQUEUE_WEBHOOKS]: { allowed: true },
    [JOB.WAKE_SNOOZED]: { allowed: true },
    [JOB.EXPIRE_PROPOSALS]: { allowed: true },
    [JOB.AUDIT_PROPOSAL_TOTALS]: { allowed: true },
    [JOB.GENERATE_COACH_TIPS]: { allowed: true },
    [JOB.GENERATE_DAILY_BRIEFS]: { allowed: true },
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
  [JOB.OPPORTUNITY_ACTION]: "Enrich or research opportunity",
  [JOB.OPPORTUNITY_DISCOVERY]: "Discover opportunities",
  [JOB.OPPORTUNITY_WATCHES]: "Refresh opportunity watches",
  [JOB.OPPORTUNITY_ENRICHMENT]: "Enrich an opportunity",
  [JOB.RESCORE_WORKSPACE]: "Rescore all leads",
  [JOB.RESCORE_LEAD]: "Rescore one lead",
  [JOB.DETECT_DEAL_RISKS]: "Detect deal risks",
  [JOB.ARCHIVE_STALE_LEADS]: "Archive stale leads",
  [JOB.PURGE_RECYCLE_BIN]: "Purge recycle bin",
  [JOB.REFRESH_NEXT_ACTIONS]: "Refresh next best actions",
  [JOB.RESCORE_WORKLIST]: "Re-rank worklist",
  [JOB.DELIVER_WEBHOOK]: "Deliver webhook",
  [JOB.SWEEP_NOTIFICATIONS]: "Sweep notifications",
  [JOB.REQUEUE_WEBHOOKS]: "Re-send stranded webhooks",
  [JOB.SEND_MESSAGE]: "Send one message",
  [JOB.ADVANCE_SEQUENCES]: "Advance sequences",
  [JOB.WAKE_SNOOZED]: "Wake snoozed threads",
  [JOB.EXPIRE_PROPOSALS]: "Expire proposals",
  [JOB.AUDIT_PROPOSAL_TOTALS]: "Audit proposal totals",
  [JOB.GENERATE_COACH_TIPS]: "Generate sales coach tips",
  [JOB.GENERATE_DAILY_BRIEFS]: "Generate daily briefs",
};

// ---------------------------------------------------------------------------
// Envelope validation and scheduler identity
// ---------------------------------------------------------------------------

/**
 * BullMQ reserves ':' as its own key separator and rejects a custom job id
 * containing one, so ids are normalised here rather than every caller having
 * to remember. Anything outside a safe set becomes a dash.
 */
export function safeJobId(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 200);
}

/** The one id a recurring job for a workspace is scheduled under. */
export function schedulerId(name: JobName, workspaceId: string): string {
  return safeJobId(`${name}-${workspaceId}`);
}

/**
 * The schedulers that should exist for these workspaces. Anything else in Redis
 * is stale: a workspace that was deleted, a job that was unscheduled, or the
 * pre-`safeJobId` `name:workspace` format — which ran every job twice beside
 * its replacement.
 */
export function staleSchedulerIds(existing: string[], workspaceIds: string[]): string[] {
  const expected = new Set(
    (Object.keys(JOB_SCHEDULE) as JobName[]).flatMap((name) => workspaceIds.map((ws) => schedulerId(name, ws)))
  );
  return existing.filter((id) => !expected.has(id));
}

/** A job the worker refuses before running anything. Retrying it cannot help. */
export class JobEnvelopeError extends Error {
  readonly retryable = false;
  constructor(message: string, readonly code: "no_payload" | "unknown_job" | "no_workspace" | "workspace_gone") {
    super(message);
    this.name = "JobEnvelopeError";
  }
}

const JOB_NAMES = new Set<string>(Object.values(JOB));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks what BullMQ handed the worker before a handler sees it.
 *
 * The historical "Job undefined received no workspaceId" failures were jobs
 * whose Redis record had been emptied while still scheduled — no name, no
 * payload — for workspaces that had since been deleted. Every handler is
 * workspace-scoped, so a job with no workspace must fail here rather than run
 * against nothing (or, worse, everything).
 */
export function validateJobEnvelope(
  jobId: string | undefined,
  name: string | undefined,
  data: unknown
): { name: JobName; workspaceId: string } {
  const ref = jobId ? `Job ${jobId}` : "A job";
  if (!name && (data === undefined || data === null || (typeof data === "object" && Object.keys(data).length === 0))) {
    throw new JobEnvelopeError(
      `${ref} has no name and no payload: its record was emptied in Redis while it was still scheduled, usually because its workspace was deleted. Nothing ran. The worker removes stale schedules on its next start.`,
      "no_payload"
    );
  }
  if (!name || !JOB_NAMES.has(name)) {
    throw new JobEnvelopeError(`${ref} is named "${name ?? ""}", which this version does not run. Nothing ran. If it is an old schedule, restarting the worker removes it.`, "unknown_job");
  }
  const workspaceId = (data as { workspaceId?: unknown } | null)?.workspaceId;
  if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) {
    throw new JobEnvelopeError(`${ref} (${name}) carries no valid workspaceId, so it was refused rather than run unscoped. Nothing ran.`, "no_workspace");
  }
  return { name: name as JobName, workspaceId };
}

/** The scheduler a repeat job came from: `repeat:<schedulerId>:<millis>`. */
export function schedulerIdOfJob(jobId: string | undefined): string | null {
  const m = /^repeat:(.+):\d+$/.exec(jobId ?? "");
  return m ? m[1] : null;
}
