import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate } from "@/lib/services/mutate";
import { TOOLS, type RiskClass } from "@/lib/ai/tools";
import { isConfigured as isAiConfigured, NOT_CONFIGURED_MESSAGE } from "@/lib/ai/provider";
import { isEmailConfigured } from "@/lib/outreach/provider";
import {
  evaluate,
  describePolicy,
  type AutopilotSettings,
  type AgentSettings,
  type ProposedAction,
  type Verdict,
} from "@/lib/autopilot/guardrails";
import { localParts } from "@/lib/outreach/sendability";

/**
 * Autopilot and the agent layer.
 *
 * The honest position, stated everywhere it matters: **no AI provider is
 * configured, so no agent can reason and none of them run.** What is real and
 * exercisable right now is everything around the reasoning — the guardrails,
 * the budgets, the per-agent tool grants, the approval queue and the audit
 * trail. The dry run below proves that by evaluating real leads against the
 * real rules without an agent existing at all.
 */

const DEFAULTS: AutopilotSettings = {
  mode: "OFF",
  maxLeadsPerDay: 20,
  maxRevealsPerDay: 5,
  maxPointsPerDay: 25,
  maxEmailsPerDay: 30,
  maxWhatsappPerDay: 10,
  maxLinkedinPerDay: 10,
  allowedTiers: ["A", "B"],
  minScore: 70,
  allowedIndustries: [],
  allowedLocations: [],
  allowedChannels: ["EMAIL"],
  sendWindowStart: 9,
  sendWindowEnd: 19,
  sendDays: [1, 2, 3, 4, 5],
  blockedDomains: [],
  blockedCompanies: [],
  approvalThresholdInr: 0,
  requireApprovalForSpend: true,
};

function toSettings(row: {
  mode: string;
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
  approvalThresholdInr: unknown;
  requireApprovalForSpend: boolean;
}): AutopilotSettings {
  return {
    mode: row.mode as AutopilotSettings["mode"],
    maxLeadsPerDay: row.maxLeadsPerDay,
    maxRevealsPerDay: row.maxRevealsPerDay,
    maxPointsPerDay: row.maxPointsPerDay,
    maxEmailsPerDay: row.maxEmailsPerDay,
    maxWhatsappPerDay: row.maxWhatsappPerDay,
    maxLinkedinPerDay: row.maxLinkedinPerDay,
    allowedTiers: row.allowedTiers,
    minScore: row.minScore,
    allowedIndustries: row.allowedIndustries,
    allowedLocations: row.allowedLocations,
    allowedChannels: row.allowedChannels,
    sendWindowStart: row.sendWindowStart,
    sendWindowEnd: row.sendWindowEnd,
    sendDays: row.sendDays,
    blockedDomains: row.blockedDomains,
    blockedCompanies: row.blockedCompanies,
    approvalThresholdInr: Number(row.approvalThresholdInr),
    requireApprovalForSpend: row.requireApprovalForSpend,
  };
}

export async function getAutopilotConfig(ctx: AuthContext) {
  const row = await db.autopilotConfig.findUnique({ where: { workspaceId: ctx.workspaceId } });
  const settings = row ? toSettings(row) : DEFAULTS;

  return {
    settings,
    /** Whether a row exists, so the UI does not present defaults as choices made. */
    configured: row !== null,
    policy: describePolicy(settings),
    /**
     * The single most important fact on this screen: with no model provider,
     * no agent can decide anything, so nothing runs regardless of mode.
     */
    aiConfigured: isAiConfigured(),
    aiMessage: NOT_CONFIGURED_MESSAGE,
  };
}

const configSchema = z.object({
  mode: z.enum(["OFF", "REVIEW_FIRST", "FULL_AUTO"]),
  maxLeadsPerDay: z.number().int().min(0).max(1000),
  maxRevealsPerDay: z.number().int().min(0).max(500),
  maxPointsPerDay: z.number().int().min(0).max(10_000),
  maxEmailsPerDay: z.number().int().min(0).max(2000),
  maxWhatsappPerDay: z.number().int().min(0).max(2000),
  maxLinkedinPerDay: z.number().int().min(0).max(2000),
  allowedTiers: z.array(z.enum(["A", "B", "C", "D"])).max(4),
  minScore: z.number().int().min(0).max(100),
  allowedIndustries: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  allowedLocations: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  allowedChannels: z
    .array(z.enum(["EMAIL", "WHATSAPP", "LINKEDIN", "PHONE", "SMS", "IN_PERSON"]))
    .max(6),
  sendWindowStart: z.number().int().min(0).max(23),
  sendWindowEnd: z.number().int().min(1).max(24),
  sendDays: z.array(z.number().int().min(1).max(7)).max(7),
  blockedDomains: z.array(z.string().trim().min(2).max(120)).max(200).default([]),
  blockedCompanies: z.array(z.string().trim().min(2).max(160)).max(200).default([]),
  approvalThresholdInr: z.number().min(0).max(1_000_000_000),
  requireApprovalForSpend: z.boolean(),
});

export type AutopilotInput = z.input<typeof configSchema>;

export async function updateAutopilotConfig(ctx: AuthContext, raw: AutopilotInput) {
  const input = configSchema.parse(raw);

  if (input.sendWindowEnd <= input.sendWindowStart) {
    throw new MutationError(
      `The send window closes at ${input.sendWindowEnd}:00, which is not after it opens at ${input.sendWindowStart}:00 — nothing would ever send.`,
      "bad_window",
      422
    );
  }
  if (input.mode !== "OFF" && input.allowedTiers.length === 0) {
    throw new MutationError(
      "No tiers are selected, so autopilot would be on but able to touch nothing. Pick at least one tier, or switch it off.",
      "no_tiers",
      422
    );
  }
  if (input.mode !== "OFF" && input.sendDays.length === 0) {
    throw new MutationError(
      "No sending days are selected. Autopilot would hold every send indefinitely rather than refusing it, which looks like a stall.",
      "no_days",
      422
    );
  }
  if (input.mode === "FULL_AUTO" && !isAiConfigured()) {
    throw new MutationError(
      `Full-auto means agents act without asking, and no model provider is connected — so nothing would act, and the mode would misrepresent what the system does. ${NOT_CONFIGURED_MESSAGE}`,
      "no_ai_provider",
      422
    );
  }

  const before = await db.autopilotConfig.findUnique({ where: { workspaceId: ctx.workspaceId } });

  return mutate(ctx, PERMISSIONS.AUTOPILOT_CONFIGURE, async () => {
    const row = await db.autopilotConfig.upsert({
      where: { workspaceId: ctx.workspaceId },
      create: { workspaceId: ctx.workspaceId, ...input },
      update: input,
    });

    // Mode is mirrored onto the workspace, which the shell badge reads.
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: { autopilotMode: input.mode },
    });

    const settings = toSettings(row);
    return {
      result: {
        settings,
        policy: describePolicy(settings),
        note:
          input.mode === "OFF"
            ? "Autopilot is off. Agents can read to answer questions and nothing else."
            : input.mode === "REVIEW_FIRST"
              ? "Saved. Every agent action will wait for a person, so nothing takes effect unreviewed."
              : "Saved in full-auto. Agents act within these limits without asking.",
      },
      log: {
        action: "autopilot.updated",
        objectType: "AutopilotConfig",
        objectId: row.id,
        before: before ? { mode: before.mode, minScore: before.minScore } : null,
        after: { mode: input.mode, minScore: input.minScore },
        activity: {
          kind: "autopilot.updated",
          summary: `Autopilot set to ${input.mode.toLowerCase().replace(/_/g, " ")}`,
        },
      },
    };
  });
}

/** The registry, indexed, plus a lookup that admits when a tool is unknown. */
const TOOL_INDEX = new Map(TOOLS.map((t) => [t.name, t]));

export function toolHealth(name: string): {
  known: boolean;
  implemented: boolean;
  riskClass: RiskClass | null;
} {
  const tool = TOOL_INDEX.get(name);
  return {
    known: tool !== undefined,
    implemented: tool?.implemented ?? false,
    riskClass: tool?.riskClass ?? null,
  };
}

/**
 * Agents, with their configuration checked against the registry.
 *
 * An agent can be configured — by a seed, an import, or an older version of
 * this app — with a tool the registry does not define. That agent cannot do
 * anything, and saying "enabled" next to it would be a lie. Each agent
 * therefore reports which of its tools are unknown, which are declared but
 * unbuilt, and whether anything at all is usable.
 */
export async function listAgents(ctx: AuthContext) {
  const [agents, config] = await Promise.all([
    db.aIAgent.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: { kind: "asc" },
      include: {
        runs: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: {
            id: true,
            state: true,
            startedAt: true,
            finishedAt: true,
            summary: true,
            pointsSpent: true,
            actionsTaken: true,
            actionsHeld: true,
            errorMessage: true,
          },
        },
        _count: { select: { runs: true } },
      },
    }),
    getAutopilotConfig(ctx),
  ]);

  const since = startOfLocalDay(ctx.workspace.timezone);

  const usage = await db.agentAction.groupBy({
    by: ["runId"],
    where: { workspaceId: ctx.workspaceId, occurredAt: { gte: since } },
    _sum: { pointsSpent: true },
    _count: { _all: true },
  });
  const runToAgent = new Map(
    (
      await db.agentRun.findMany({
        where: { workspaceId: ctx.workspaceId, id: { in: usage.map((u) => u.runId) } },
        select: { id: true, agentId: true },
      })
    ).map((r) => [r.id, r.agentId])
  );
  const perAgent = new Map<string, { points: number; actions: number }>();
  for (const u of usage) {
    const agentId = runToAgent.get(u.runId);
    if (!agentId) continue;
    const cur = perAgent.get(agentId) ?? { points: 0, actions: 0 };
    perAgent.set(agentId, {
      points: cur.points + (u._sum.pointsSpent ?? 0),
      actions: cur.actions + u._count._all,
    });
  }

  return agents.map((a) => {
    const tools = a.tools.map((name) => ({ name, ...toolHealth(name) }));
    const unknown = tools.filter((t) => !t.known).map((t) => t.name);
    const unbuilt = tools.filter((t) => t.known && !t.implemented).map((t) => t.name);
    const usable = tools.filter((t) => t.known && t.implemented).map((t) => t.name);
    const used = perAgent.get(a.id) ?? { points: 0, actions: 0 };

    return {
      id: a.id,
      kind: a.kind,
      name: a.name,
      goal: a.goal,
      isEnabled: a.isEnabled,
      approvalPolicy: a.approvalPolicy,
      dailyPointBudget: a.dailyPointBudget,
      dailyActionCap: a.dailyActionCap,
      tools,
      /**
       * Whether this agent could do anything at all if it ran. An agent whose
       * every tool is unknown or unbuilt is inert no matter what its switch
       * says, and the screen must lead with that rather than with "Enabled".
       */
      health: {
        usable: usable.length,
        unknown,
        unbuilt,
        inert: usable.length === 0,
      },
      usedToday: used,
      runCount: a._count.runs,
      lastRun: a.runs[0]
        ? {
            ...a.runs[0],
            startedAt: a.runs[0].startedAt.toISOString(),
            finishedAt: a.runs[0].finishedAt?.toISOString() ?? null,
          }
        : null,
      /** The reason this agent will not run right now, if there is one. */
      blockedBecause: !config.aiConfigured
        ? "No model provider is connected, so no agent can decide anything."
        : config.settings.mode === "OFF"
          ? "Autopilot is off."
          : !a.isEnabled
            ? "This agent is switched off."
            : usable.length === 0
              ? "None of its tools are built yet."
              : null,
    };
  });
}

function startOfLocalDay(timezone: string): Date {
  const now = new Date();
  const { hour, minute } = localParts(now, timezone);
  return new Date(now.getTime() - (hour * 60 + minute) * 60_000);
}

export async function setAgentEnabled(ctx: AuthContext, id: string, isEnabled: boolean) {
  const agent = await loadScoped(
    () =>
      db.aIAgent.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
        select: { id: true, name: true, isEnabled: true, tools: true },
      }),
    "That agent"
  );

  if (isEnabled) {
    const usable = agent.tools.filter((t) => {
      const h = toolHealth(t);
      return h.known && h.implemented;
    });
    if (usable.length === 0) {
      const unknown = agent.tools.filter((t) => !toolHealth(t).known);
      throw new MutationError(
        unknown.length > 0
          ? `${agent.name} would do nothing: ${unknown.map((t) => `"${t}"`).join(", ")} ${unknown.length === 1 ? "is not a tool" : "are not tools"} this app defines, and nothing else it has is built yet.`
          : `${agent.name} would do nothing — none of its tools are built yet. Enabling it would put a switch on a feature that does not exist.`,
        "agent_inert",
        422
      );
    }
  }

  return mutate(ctx, PERMISSIONS.AGENTS_CONFIGURE, async () => {
    const updated = await db.aIAgent.update({ where: { id }, data: { isEnabled } });
    return {
      result: {
        agent: toPlain(updated),
        note: isEnabled
          ? isAiConfigured()
            ? `${agent.name} is on.`
            : `${agent.name} is on, but no model provider is connected, so it still will not run.`
          : `${agent.name} is off.`,
      },
      log: {
        action: isEnabled ? "agent.enabled" : "agent.disabled",
        objectType: "AIAgent",
        objectId: id,
        before: { isEnabled: agent.isEnabled },
        after: { isEnabled },
        activity: {
          kind: isEnabled ? "agent.enabled" : "agent.disabled",
          summary: `${agent.name} ${isEnabled ? "enabled" : "disabled"}`,
        },
      },
    };
  });
}

/**
 * The dry run.
 *
 * Takes real candidate leads and asks the real evaluator what would happen to
 * each, for a representative action. No agent runs, nothing is written, no
 * model is called — which is exactly why this works with no provider
 * connected, and why it is the honest way to show what autopilot would do.
 */
export async function dryRunAgent(ctx: AuthContext, agentId: string, limit = 12) {
  const agent = await loadScoped(
    () =>
      db.aIAgent.findFirst({
        where: { id: agentId, workspaceId: ctx.workspaceId, deletedAt: null },
      }),
    "That agent"
  );

  const config = await getAutopilotConfig(ctx);
  const leads = await db.lead.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      archivedAt: null,
      ...leadVisibilityFilter(ctx),
    },
    orderBy: { surfacedAt: "desc" },
    take: limit,
    select: {
      id: true,
      tier: true,
      person: { select: { fullName: true } },
      company: { select: { name: true, industry: true, state: true, domain: true } },
      // Both scales: the composite is what the guardrails compare, the
      // display score is what the rest of the UI shows.
      score: { select: { composite: true, displayScore: true } },
    },
  });

  const suppressed = new Set(
    (
      await db.suppression.findMany({
        where: { workspaceId: ctx.workspaceId, kind: "domain" },
        select: { value: true },
      })
    ).map((s) => s.value.toLowerCase())
  );

  const { weekday, hour } = localParts(new Date(), ctx.workspace.timezone);

  // The most consequential tool the agent holds, so the dry run shows the
  // hardest case rather than the easiest.
  const ranked: RiskClass[] = ["EXTERNAL", "SPEND", "WRITE", "READ"];
  const chosen =
    agent.tools
      .map((name) => ({ name, ...toolHealth(name) }))
      .filter((t) => t.known)
      .sort((a, b) => ranked.indexOf(a.riskClass!) - ranked.indexOf(b.riskClass!))[0] ??
    (agent.tools[0] ? { name: agent.tools[0], ...toolHealth(agent.tools[0]) } : null);

  const agentSettings: AgentSettings = {
    kind: agent.kind,
    name: agent.name,
    isEnabled: agent.isEnabled,
    tools: agent.tools,
    approvalPolicy: agent.approvalPolicy,
    dailyPointBudget: agent.dailyPointBudget,
    dailyActionCap: agent.dailyActionCap,
  };

  const usedToday = { points: 0, actions: 0, emails: 0, whatsapp: 0, linkedin: 0, leads: 0, reveals: 0 };

  const rows = leads.map((lead) => {
    const action: ProposedAction = {
      tool: chosen?.name ?? "unknown",
      riskClass: chosen?.riskClass ?? "WRITE",
      pointsCost: chosen?.riskClass === "SPEND" ? 1 : 0,
      channel: chosen?.riskClass === "EXTERNAL" ? "EMAIL" : undefined,
      lead: {
        tier: lead.tier,
        scoreOutOf100: lead.score ? lead.score.composite : 0,
        industry: lead.company.industry,
        location: lead.company.state,
        companyName: lead.company.name,
        domain: lead.company.domain,
        isSuppressed: lead.company.domain
          ? suppressed.has(lead.company.domain.toLowerCase())
          : false,
      },
    };

    const verdict: Verdict = evaluate({
      autopilot: config.settings,
      agent: agentSettings,
      action,
      usedToday,
      tool: chosen ? { known: chosen.known, implemented: chosen.implemented } : null,
      providerReady: isEmailConfigured(),
      localWeekday: weekday,
      localHour: hour,
    });

    return {
      leadId: lead.id,
      name: lead.person.fullName,
      company: lead.company.name,
      tier: lead.tier,
      score: lead.score ? Number(lead.score.displayScore) : null,
      disposition: verdict.disposition,
      headline: verdict.headline?.message ?? "Nothing stands in the way.",
      guards: verdict.guards,
    };
  });

  const tally = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.disposition] = (acc[r.disposition] ?? 0) + 1;
    return acc;
  }, {});

  return {
    agent: { id: agent.id, name: agent.name, kind: agent.kind },
    /** The action the dry run evaluated, named so the result is interpretable. */
    consideredAction: chosen
      ? { tool: chosen.name, riskClass: chosen.riskClass, known: chosen.known, implemented: chosen.implemented }
      : null,
    examined: rows.length,
    tally,
    rows,
    note: !config.aiConfigured
      ? "These are the real rules against your real leads. No agent ran and nothing was written — with no model provider connected, an agent could not choose what to do in the first place."
      : "These are the real rules against your real leads. No agent ran and nothing was written.",
  };
}

/**
 * The approval queue for agent actions.
 *
 * Distinct from the message approval queue in the Inbox: that one approves a
 * specific drafted message, this one approves an action an agent wants to take.
 */
export async function listPendingActions(ctx: AuthContext) {
  const actions = await db.agentAction.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      requiresApproval: true,
      state: "pending_approval",
    },
    orderBy: { occurredAt: "asc" },
    take: 100,
    include: {
      run: {
        select: {
          id: true,
          trigger: true,
          agent: { select: { id: true, name: true, kind: true } },
        },
      },
    },
  });

  return actions.map((a) => ({
    id: a.id,
    tool: a.tool,
    riskClass: a.riskClass,
    summary: a.summary,
    input: a.input,
    pointsSpent: a.pointsSpent,
    leadId: a.leadId,
    dealId: a.dealId,
    occurredAt: a.occurredAt.toISOString(),
    agent: a.run.agent,
    trigger: a.run.trigger,
    /** Whether approving it could actually take effect. */
    executable: toolHealth(a.tool).implemented,
  }));
}

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

export async function decideOnAgentAction(
  ctx: AuthContext,
  id: string,
  raw: z.input<typeof decisionSchema>
) {
  const input = decisionSchema.parse(raw);

  const action = await loadScoped(
    () =>
      db.agentAction.findFirst({
        where: { id, workspaceId: ctx.workspaceId },
        include: { run: { select: { id: true, agent: { select: { name: true } } } } },
      }),
    "That action"
  );

  if (action.state !== "pending_approval") {
    throw new MutationError(
      `This action is ${action.state.replace(/_/g, " ")}, not waiting for approval.`,
      "not_pending",
      409
    );
  }
  if (input.decision === "reject" && !input.reason) {
    throw new MutationError(
      "Rejecting needs a reason — it is the record of why an agent was overruled.",
      "reason_required",
      422
    );
  }

  const health = toolHealth(action.tool);
  if (input.decision === "approve" && !health.implemented) {
    throw new MutationError(
      health.known
        ? `Approving would do nothing: "${action.tool}" is declared but not built yet.`
        : `Approving would do nothing: "${action.tool}" is not a tool this app defines.`,
      "not_executable",
      422
    );
  }

  return mutate(ctx, PERMISSIONS.OUTREACH_APPROVE, async () => {
    const now = new Date();
    const updated = await db.agentAction.update({
      where: { id },
      data:
        input.decision === "approve"
          ? { state: "approved", approvedById: ctx.userId, approvedAt: now, requiresApproval: false }
          : { state: "rejected", rejectedAt: now, requiresApproval: false },
    });

    return {
      result: {
        action: toPlain(updated),
        note:
          input.decision === "approve"
            ? "Approved. The guardrails are re-checked at the moment it runs."
            : "Rejected. Nothing was done, and the reason is on the audit trail.",
      },
      log: {
        action: input.decision === "approve" ? "agent_action.approved" : "agent_action.rejected",
        objectType: "AgentAction",
        objectId: id,
        before: { state: action.state },
        after: { state: updated.state, reason: input.reason ?? null },
        activity: {
          kind: input.decision === "approve" ? "agent_action.approved" : "agent_action.rejected",
          summary:
            input.decision === "approve"
              ? `Approved ${action.run.agent.name}: ${action.summary}`
              : `Overruled ${action.run.agent.name}: ${input.reason}`,
          leadId: action.leadId ?? undefined,
        },
      },
    };
  });
}

/** Recent runs, for the activity view. */
export async function listAgentRuns(ctx: AuthContext, limit = 40) {
  const runs = await db.agentRun.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      agent: { select: { id: true, name: true, kind: true } },
      actions: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          tool: true,
          riskClass: true,
          summary: true,
          state: true,
          pointsSpent: true,
          requiresApproval: true,
          occurredAt: true,
        },
      },
    },
  });

  return runs.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    state: r.state,
    summary: r.summary,
    pointsSpent: r.pointsSpent,
    actionsTaken: r.actionsTaken,
    actionsHeld: r.actionsHeld,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    errorMessage: r.errorMessage,
    agent: r.agent,
    actions: r.actions.map((a) => ({
      ...a,
      occurredAt: a.occurredAt.toISOString(),
      executable: toolHealth(a.tool).implemented,
    })),
  }));
}
