/**
 * §63 / §64 — every rule that can stop an agent, in one pure function.
 *
 * The same shape as `lib/outreach/sendability.ts`, and for the same reason:
 * the settings screen, the dry run, the agent runner and the approval queue
 * must all answer "would this be allowed?" identically. If the preview and the
 * runner can disagree, an operator cannot trust either.
 *
 * A guardrail decision is never a boolean. It is one of four dispositions,
 * because "no" and "not without a human" are completely different answers:
 *
 *   allow    — act now and record it
 *   approve  — do the work, hold the effect, ask a person
 *   defer    — a limit that time resets (a daily cap, a send window)
 *   refuse   — this can never happen as configured
 */

export type RiskClass = "READ" | "WRITE" | "SPEND" | "EXTERNAL";

export type Disposition = "allow" | "approve" | "defer" | "refuse";

export type GuardCode =
  | "autopilot_off"
  | "agent_disabled"
  | "tool_not_granted"
  | "tool_unknown"
  | "tool_not_implemented"
  | "mode_requires_review"
  | "policy_requires_review"
  | "spend_requires_approval"
  | "point_budget_exhausted"
  | "action_cap_reached"
  | "channel_not_allowed"
  | "channel_cap_reached"
  | "no_provider"
  | "outside_send_window"
  | "tier_not_allowed"
  | "score_below_minimum"
  | "industry_not_allowed"
  | "location_not_allowed"
  | "company_blocked"
  | "domain_blocked"
  | "value_over_threshold"
  | "lead_suppressed";

export type Guard = {
  code: GuardCode;
  /** Written for an operator: this text goes on screen and into the audit row. */
  message: string;
  disposition: Exclude<Disposition, "allow">;
};

export type AutopilotSettings = {
  mode: "OFF" | "REVIEW_FIRST" | "FULL_AUTO";
  maxLeadsPerDay: number;
  maxRevealsPerDay: number;
  maxPointsPerDay: number;
  maxEmailsPerDay: number;
  maxWhatsappPerDay: number;
  maxLinkedinPerDay: number;
  allowedTiers: string[];
  minScore: number;
  allowedIndustries: string[];
  allowedLocations: string[];
  allowedChannels: string[];
  sendWindowStart: number;
  sendWindowEnd: number;
  sendDays: number[];
  blockedDomains: string[];
  blockedCompanies: string[];
  approvalThresholdInr: number;
  requireApprovalForSpend: boolean;
};

export type AgentSettings = {
  kind: string;
  name: string;
  isEnabled: boolean;
  /** Tools this agent is permitted to call. */
  tools: string[];
  /** "review_first" | "auto_within_budget" */
  approvalPolicy: string;
  dailyPointBudget: number;
  dailyActionCap: number;
};

/** What the agent proposes to do. */
export type ProposedAction = {
  tool: string;
  riskClass: RiskClass;
  /** Points this action would spend. Zero for anything but a SPEND action. */
  pointsCost: number;
  channel?: string;
  /** Money at stake, for the approval threshold — a deal value, a proposal total. */
  valueInr?: number;
  /** The lead this would act on, when it acts on one. */
  lead?: {
    tier: string;
    /**
     * The 0–100 composite, **not** the 0–10 display score.
     *
     * Named for its scale on purpose: `minScore` is a composite threshold
     * (70 by default), and passing `displayScore` here silently refused every
     * lead in the workspace for being "below 70" when it scored 7.0.
     */
    scoreOutOf100: number;
    industry: string | null;
    location: string | null;
    companyName: string;
    domain: string | null;
    isSuppressed: boolean;
  };
};

/** Everything the evaluator needs about the world right now. */
export type GuardContext = {
  autopilot: AutopilesSettingsAlias;
  agent: AgentSettings;
  action: ProposedAction;
  /** Usage so far today, counted from recorded agent actions. */
  usedToday: {
    points: number;
    actions: number;
    emails: number;
    whatsapp: number;
    linkedin: number;
    leads: number;
    reveals: number;
  };
  /** Whether the tool exists in the registry, and whether it does anything. */
  tool: { known: boolean; implemented: boolean } | null;
  /** Whether a provider exists for an EXTERNAL action on this channel. */
  providerReady: boolean;
  /** Local weekday (1–7) and hour where the workspace is. */
  localWeekday: number;
  localHour: number;
  /**
   * True when a person has already approved this exact action and it is now
   * being executed.
   *
   * The approval-scoped guards are then satisfied and must not fire again —
   * otherwise review-first mode deadlocks: the re-check at execution time sees
   * "this mode requires review", holds the action a second time, and approving
   * that one holds a third. Everything else still applies. Approval is
   * permission to act, not an exemption from suppression, budgets, send
   * windows or a missing provider.
   */
  alreadyApproved?: boolean;
};

// Kept as an alias so the long settings type reads cleanly above.
type AutopilesSettingsAlias = AutopilotSettings;

export type Verdict = {
  disposition: Disposition;
  guards: Guard[];
  /** The single reason to show first, chosen by severity rather than order. */
  headline: Guard | null;
};

const SEVERITY: Record<Exclude<Disposition, "allow">, number> = {
  refuse: 3,
  approve: 2,
  defer: 1,
};

/**
 * Evaluates one proposed action.
 *
 * READ actions are treated as safe: they cannot change anything, spend
 * anything or reach outside. Everything else must earn its way through.
 */
export function evaluate(ctx: GuardContext): Verdict {
  const guards: Guard[] = [];
  const add = (code: GuardCode, message: string, disposition: Guard["disposition"]) =>
    guards.push({ code, message, disposition });

  const { autopilot, agent, action, usedToday } = ctx;
  const writes = action.riskClass !== "READ";

  // ---- Is anything allowed to run at all? -------------------------------
  if (autopilot.mode === "OFF" && writes) {
    add(
      "autopilot_off",
      "Autopilot is off, so agents may read but never act.",
      "refuse"
    );
  }
  if (!agent.isEnabled) {
    add("agent_disabled", `The ${agent.name} is switched off.`, "refuse");
  }

  // ---- Is this agent allowed this tool? ---------------------------------
  if (!agent.tools.includes(action.tool)) {
    add(
      "tool_not_granted",
      `${agent.name} is not granted "${action.tool}". An agent can only call tools listed against it.`,
      "refuse"
    );
  }
  if (ctx.tool === null || !ctx.tool.known) {
    add(
      "tool_unknown",
      `"${action.tool}" is not a tool this app defines, so nothing can run it. Remove it from the agent, or the agent will keep trying.`,
      "refuse"
    );
  } else if (!ctx.tool.implemented) {
    add(
      "tool_not_implemented",
      `"${action.tool}" is declared but not built yet, so it would do nothing.`,
      "refuse"
    );
  }

  // ---- Targeting: is this lead in scope? --------------------------------
  if (action.lead) {
    const lead = action.lead;
    if (lead.isSuppressed) {
      add(
        "lead_suppressed",
        `${lead.companyName} is on the do-not-contact list. No agent may reach them.`,
        "refuse"
      );
    }
    if (autopilot.allowedTiers.length > 0 && !autopilot.allowedTiers.includes(lead.tier)) {
      add(
        "tier_not_allowed",
        `Tier ${lead.tier} is outside autopilot's remit (${autopilot.allowedTiers.join(", ")}).`,
        "refuse"
      );
    }
    if (lead.scoreOutOf100 < autopilot.minScore) {
      add(
        "score_below_minimum",
        `Scores ${lead.scoreOutOf100} out of 100, below the autopilot minimum of ${autopilot.minScore}.`,
        "refuse"
      );
    }
    if (
      autopilot.allowedIndustries.length > 0 &&
      (!lead.industry || !autopilot.allowedIndustries.includes(lead.industry))
    ) {
      add(
        "industry_not_allowed",
        `${lead.industry ?? "An unknown industry"} is not in autopilot's allowed list.`,
        "refuse"
      );
    }
    if (
      autopilot.allowedLocations.length > 0 &&
      (!lead.location || !autopilot.allowedLocations.includes(lead.location))
    ) {
      add(
        "location_not_allowed",
        `${lead.location ?? "An unknown location"} is not in autopilot's allowed list.`,
        "refuse"
      );
    }
    if (
      autopilot.blockedCompanies.some(
        (c) => c.toLowerCase() === lead.companyName.toLowerCase()
      )
    ) {
      add("company_blocked", `${lead.companyName} is on the blocked-companies list.`, "refuse");
    }
    if (
      lead.domain &&
      autopilot.blockedDomains.some((d) => lead.domain!.toLowerCase().endsWith(d.toLowerCase()))
    ) {
      add("domain_blocked", `${lead.domain} is on the blocked-domains list.`, "refuse");
    }
  }

  // ---- Channels and providers ------------------------------------------
  if (action.riskClass === "EXTERNAL") {
    if (action.channel && !autopilot.allowedChannels.includes(action.channel)) {
      add(
        "channel_not_allowed",
        `Autopilot may not use ${action.channel}. Allowed: ${autopilot.allowedChannels.join(", ") || "none"}.`,
        "refuse"
      );
    }
    if (!ctx.providerReady) {
      add(
        "no_provider",
        `No provider is connected for ${action.channel ?? "that channel"}, so this could not be delivered.`,
        "refuse"
      );
    }
  }

  // ---- Budgets and caps: limits the clock resets ------------------------
  if (writes) {
    if (agent.dailyActionCap > 0 && usedToday.actions >= agent.dailyActionCap) {
      add(
        "action_cap_reached",
        `${agent.name} has used its ${agent.dailyActionCap} actions for today.`,
        "defer"
      );
    }
    if (action.pointsCost > 0) {
      const agentBudget = agent.dailyPointBudget;
      if (agentBudget > 0 && usedToday.points + action.pointsCost > agentBudget) {
        add(
          "point_budget_exhausted",
          `This would take ${agent.name} to ${usedToday.points + action.pointsCost} points today, over its budget of ${agentBudget}.`,
          "defer"
        );
      }
      if (usedToday.points + action.pointsCost > autopilot.maxPointsPerDay) {
        add(
          "point_budget_exhausted",
          `This would take autopilot to ${usedToday.points + action.pointsCost} points today, over the workspace limit of ${autopilot.maxPointsPerDay}.`,
          "defer"
        );
      }
    }

    const channelCap: Record<string, { used: number; cap: number }> = {
      EMAIL: { used: usedToday.emails, cap: autopilot.maxEmailsPerDay },
      WHATSAPP: { used: usedToday.whatsapp, cap: autopilot.maxWhatsappPerDay },
      LINKEDIN: { used: usedToday.linkedin, cap: autopilot.maxLinkedinPerDay },
    };
    const forChannel = action.channel ? channelCap[action.channel] : undefined;
    if (forChannel && forChannel.used >= forChannel.cap) {
      add(
        "channel_cap_reached",
        `Autopilot has sent its ${forChannel.cap} ${action.channel} messages for today.`,
        "defer"
      );
    }

    if (action.riskClass === "EXTERNAL") {
      if (!autopilot.sendDays.includes(ctx.localWeekday)) {
        add("outside_send_window", "Today is not a sending day for autopilot.", "defer");
      } else if (
        ctx.localHour < autopilot.sendWindowStart ||
        ctx.localHour >= autopilot.sendWindowEnd
      ) {
        add(
          "outside_send_window",
          `It is ${String(ctx.localHour).padStart(2, "0")}:00; autopilot only sends between ${String(autopilot.sendWindowStart).padStart(2, "0")}:00 and ${String(autopilot.sendWindowEnd).padStart(2, "0")}:00.`,
          "defer"
        );
      }
    }
  }

  // ---- Who has to say yes ----------------------------------------------
  // Skipped entirely once a person has approved: these are the questions the
  // approval answered.
  if (writes && !ctx.alreadyApproved) {
    if (autopilot.mode === "REVIEW_FIRST") {
      add(
        "mode_requires_review",
        "Autopilot is in review-first mode, so a person approves every action before it takes effect.",
        "approve"
      );
    }
    if (agent.approvalPolicy === "review_first") {
      add(
        "policy_requires_review",
        `${agent.name} is set to review-first regardless of the workspace mode.`,
        "approve"
      );
    }
    if (action.pointsCost > 0 && autopilot.requireApprovalForSpend) {
      add(
        "spend_requires_approval",
        `Spending ${action.pointsCost} ${action.pointsCost === 1 ? "point" : "points"} needs approval — the workspace requires it for anything that costs.`,
        "approve"
      );
    }
    if (
      autopilot.approvalThresholdInr > 0 &&
      (action.valueInr ?? 0) >= autopilot.approvalThresholdInr
    ) {
      add(
        "value_over_threshold",
        `This touches ₹${(action.valueInr ?? 0).toLocaleString("en-IN")}, at or above the ₹${autopilot.approvalThresholdInr.toLocaleString("en-IN")} approval threshold.`,
        "approve"
      );
    }
  }

  if (guards.length === 0) return { disposition: "allow", guards: [], headline: null };

  // The worst disposition wins, and the headline is the most severe guard —
  // ordering by insertion would show "over the daily cap" ahead of "this lead
  // is on the do-not-contact list".
  const worst = guards.reduce<Guard>((a, b) => (SEVERITY[b.disposition] > SEVERITY[a.disposition] ? b : a), guards[0]);
  return { disposition: worst.disposition, guards, headline: worst };
}

/** The guards of one disposition, for grouping in the UI. */
export function guardsOf(verdict: Verdict, disposition: Guard["disposition"]): Guard[] {
  return verdict.guards.filter((g) => g.disposition === disposition);
}

/**
 * A plain-language summary of what a configuration permits, for the settings
 * screen. Built from the same settings the evaluator reads, so it cannot
 * describe a policy the evaluator would not enforce.
 */
export function describePolicy(autopilot: AutopilotSettings): string[] {
  if (autopilot.mode === "OFF") {
    return ["Agents may read your data to answer questions. They cannot change or send anything."];
  }

  const lines: string[] = [];
  lines.push(
    autopilot.mode === "REVIEW_FIRST"
      ? "Every action an agent proposes waits for a person to approve it. Nothing takes effect on its own."
      : "Agents act without asking, within the limits below."
  );
  lines.push(
    `Only tier ${autopilot.allowedTiers.join(" and ") || "—"} leads scoring ${autopilot.minScore} or above.`
  );
  if (autopilot.allowedIndustries.length > 0) {
    lines.push(`Only these industries: ${autopilot.allowedIndustries.join(", ")}.`);
  }
  if (autopilot.allowedLocations.length > 0) {
    lines.push(`Only these locations: ${autopilot.allowedLocations.join(", ")}.`);
  }
  lines.push(
    `At most ${autopilot.maxPointsPerDay} points, ${autopilot.maxEmailsPerDay} emails, ${autopilot.maxWhatsappPerDay} WhatsApp messages and ${autopilot.maxLinkedinPerDay} LinkedIn actions a day.`
  );
  lines.push(
    `Sending only ${String(autopilot.sendWindowStart).padStart(2, "0")}:00–${String(autopilot.sendWindowEnd).padStart(2, "0")}:00 on ${autopilot.sendDays.length} ${autopilot.sendDays.length === 1 ? "day" : "days"} a week.`
  );
  if (autopilot.requireApprovalForSpend) {
    lines.push("Anything that costs points needs approval, even in full-auto.");
  }
  if (autopilot.approvalThresholdInr > 0) {
    lines.push(
      `Anything touching ₹${autopilot.approvalThresholdInr.toLocaleString("en-IN")} or more needs approval.`
    );
  }
  if (autopilot.blockedCompanies.length > 0 || autopilot.blockedDomains.length > 0) {
    lines.push(
      `Never ${[...autopilot.blockedCompanies, ...autopilot.blockedDomains].join(", ")}.`
    );
  }
  return lines;
}
