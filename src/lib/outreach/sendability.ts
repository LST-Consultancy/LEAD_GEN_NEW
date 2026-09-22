/**
 * §104 — every rule that can stop a send, in one pure function.
 *
 * This is deliberately separate from the code that does the sending. The
 * engine, the "send now" button and the preview all ask the same question of
 * the same function, so the UI cannot promise a send that the worker will
 * refuse — or worse, refuse one the worker would have made.
 *
 * Every blocker carries a sentence written for the user, because these end up
 * on screen verbatim.
 */

export type BlockCode =
  | "no_provider"
  | "no_address"
  | "suppressed"
  | "unsubscribed"
  | "already_replied"
  | "sequence_paused"
  | "enrollment_stopped"
  | "outside_send_days"
  | "outside_send_window"
  | "daily_cap_reached"
  | "unresolved_variables"
  | "unknown_variables"
  | "duplicate_recent_send";

/**
 * Who has to act before this blocker clears. This drives what the engine does,
 * and getting it wrong is expensive in both directions:
 *
 *  - `schedule` — the clock clears it. Reschedule; do not consume the step.
 *  - `config`   — an admin must connect something. Leave the enrollment exactly
 *                 as it is: stopping it would mean re-enrolling everyone once
 *                 the mailbox is connected.
 *  - `sequence` — someone paused it. Same treatment as `config`.
 *  - `lead`     — this person cannot be contacted, now or later. Stop, and say
 *                 why. This is the only scope that ends an enrollment.
 *
 * An earlier version had only a boolean for "the clock will fix it", which put
 * a missing provider in the same bucket as a suppressed address — so a
 * workspace with no mailbox connected had every enrollment permanently stopped
 * by the first run of the engine.
 */
export type BlockerScope = "schedule" | "config" | "sequence" | "lead";

export type Blocker = {
  code: BlockCode;
  message: string;
  scope: BlockerScope;
  /** Convenience for `scope === "schedule"`. */
  waitsForClock: boolean;
};

export type SendContext = {
  providerConfigured: boolean;
  /** The resolved recipient address, or null when no contact method exists. */
  toAddress: string | null;
  /** Matching suppression entry, if any. */
  suppression: { reason: string; source: string } | null;
  leadRepliedAt: Date | null;
  sequence: {
    isActive: boolean;
    stopOnReply: boolean;
    stopOnUnsubscribe: boolean;
    sendWindowStart: number;
    sendWindowEnd: number;
    sendDays: number[];
    timezone: string;
    dailyCap: number;
  };
  enrollmentState: string;
  /** Sends already made by this sequence in the current local day. */
  sentToday: number;
  /**
   * Known variables this lead has no value for — a gap in *this lead's* data.
   */
  unresolvedVariables: string[];
  /**
   * Variables the app cannot fill at all, i.e. typos in the template. A fault
   * in the copy, identical for every lead, so it must not stop enrollments
   * one by one.
   */
  unknownVariables?: string[];
  /** A send to this address from this step within the dedupe horizon. */
  recentDuplicate: boolean;
  now: Date;
};

/** Local weekday (1 = Monday … 7 = Sunday) and hour in a given timezone. */
export function localParts(now: Date, timezone: string): { weekday: number; hour: number; minute: number } {
  // Intl is the only thing in the runtime that knows about DST; doing this with
  // offsets by hand is how "9am" becomes 8am for half the year.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const days: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    weekday: days[get("weekday")] ?? 1,
    // "24" appears at midnight under hour12: false in some ICU versions.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

export function checkSendable(ctx: SendContext): { sendable: boolean; blockers: Blocker[] } {
  const blockers: Blocker[] = [];
  const add = (code: BlockCode, message: string, scope: BlockerScope) =>
    blockers.push({ code, message, scope, waitsForClock: scope === "schedule" });

  if (!ctx.providerConfigured) {
    add("no_provider", "No email provider is connected, so nothing can be sent.", "config");
  }
  if (!ctx.toAddress && !ctx.suppression) {
    // Only when nothing explains the absence. When the address exists but may
    // not be used, the suppression below is the honest reason — telling someone
    // "no email address" about a contact who unsubscribed sends them looking
    // for a data problem that isn't there.
    add(
      "no_address",
      "No email address on this lead. Reveal a contact, or import one, before enrolling them.",
      "lead"
    );
  }

  // Consent first. These are the rules that must never be overridden by a
  // "send anyway", so they are checked before anything about timing.
  if (ctx.suppression) {
    const isOptOut = ctx.suppression.reason.toLowerCase().includes("unsubscrib");
    add(
      isOptOut ? "unsubscribed" : "suppressed",
      `This address is on the do-not-contact list — ${ctx.suppression.reason} (${ctx.suppression.source}). It cannot be contacted from this workspace.`,
      "lead"
    );
  }
  if (ctx.sequence.stopOnReply && ctx.leadRepliedAt) {
    add(
      "already_replied",
      "They have already replied. A sequence that keeps sending after a reply is the fastest way to lose the conversation.",
      "lead"
    );
  }

  if (!ctx.sequence.isActive) {
    add("sequence_paused", "The sequence is paused, so no steps are being sent.", "sequence");
  }
  if (ctx.enrollmentState !== "active") {
    add(
      "enrollment_stopped",
      `This lead's enrollment is ${ctx.enrollmentState}, not active.`,
      "sequence"
    );
  }
  if (ctx.unresolvedVariables.length > 0) {
    add(
      "unresolved_variables",
      `The template needs ${ctx.unresolvedVariables.map((v) => `{{${v}}}`).join(", ")}, and this lead has no value for it. Sending would show the placeholder to the recipient.`,
      "lead"
    );
  }
  if (ctx.unknownVariables && ctx.unknownVariables.length > 0) {
    // Sequence-scoped, not lead-scoped. One typo in a template would
    // otherwise stop every enrollment in the sequence, permanently, for a
    // problem that one edit fixes.
    add(
      "unknown_variables",
      `The template uses ${ctx.unknownVariables.map((v) => `{{${v}}}`).join(", ")}, which this app cannot fill. Every recipient would see the braces. Fix the step rather than the lead.`,
      "sequence"
    );
  }
  if (ctx.recentDuplicate) {
    add(
      "duplicate_recent_send",
      "This exact step already went to this address recently. Skipping it rather than sending twice.",
      "lead"
    );
  }

  // Timing last, and flagged as clock-clearable so the engine reschedules
  // instead of stopping the enrollment.
  const { weekday, hour } = localParts(ctx.now, ctx.sequence.timezone);
  if (!ctx.sequence.sendDays.includes(weekday)) {
    add(
      "outside_send_days",
      `${DAY_NAME[weekday]} is not a sending day for this sequence.`,
      "schedule"
    );
  }
  if (hour < ctx.sequence.sendWindowStart || hour >= ctx.sequence.sendWindowEnd) {
    add(
      "outside_send_window",
      `It is ${String(hour).padStart(2, "0")}:00 in ${ctx.sequence.timezone}; this sequence only sends between ${String(ctx.sequence.sendWindowStart).padStart(2, "0")}:00 and ${String(ctx.sequence.sendWindowEnd).padStart(2, "0")}:00.`,
      "schedule"
    );
  }
  if (ctx.sentToday >= ctx.sequence.dailyCap) {
    add(
      "daily_cap_reached",
      `The daily cap of ${ctx.sequence.dailyCap} for this sequence is already used up today.`,
      "schedule"
    );
  }

  return { sendable: blockers.length === 0, blockers };
}

export const DAY_NAME: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

/**
 * The next moment this sequence could send, given its window. Used to
 * reschedule a clock-blocked enrollment rather than retrying every minute.
 */
export function nextSendWindow(now: Date, sequence: SendContext["sequence"]): Date {
  if (sequence.sendDays.length === 0) {
    // No sending days at all: nothing to compute. Push a day out so the engine
    // keeps the enrollment rather than looping.
    return new Date(now.getTime() + 24 * 3600_000);
  }

  // Walk forward in hour steps. Coarse, but it is correct across DST and any
  // timezone without reimplementing a calendar, and it runs at most ~200 times.
  const limit = 24 * 8;
  for (let i = 1; i <= limit; i++) {
    const at = new Date(now.getTime() + i * 3600_000);
    const { weekday, hour } = localParts(at, sequence.timezone);
    if (!sequence.sendDays.includes(weekday)) continue;
    if (hour < sequence.sendWindowStart || hour >= sequence.sendWindowEnd) continue;
    // Land on the top of that local hour rather than a ragged minute.
    at.setMinutes(0, 0, 0);
    return at;
  }
  return new Date(now.getTime() + 24 * 3600_000);
}

/** Only blockers that a person can act on; the clock ones are just "later". */
export function actionableBlockers(blockers: Blocker[]): Blocker[] {
  return blockers.filter((b) => !b.waitsForClock);
}

/**
 * The blockers that mean *this lead* can never receive this step. Only these
 * end an enrollment; everything else is a wait on the clock, on an admin, or
 * on whoever paused the sequence.
 */
export function leadBlockers(blockers: Blocker[]): Blocker[] {
  return blockers.filter((b) => b.scope === "lead");
}

/** What the engine should do with a set of blockers. */
export function dispositionOf(
  blockers: Blocker[]
): "send" | "stop" | "reschedule" | "hold" {
  if (blockers.length === 0) return "send";
  if (blockers.some((b) => b.scope === "lead")) return "stop";
  if (blockers.some((b) => b.scope === "config" || b.scope === "sequence")) return "hold";
  return "reschedule";
}
