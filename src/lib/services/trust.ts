import "server-only";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS, SYSTEM_ROLES } from "@/lib/auth/permissions";
import { toolHealth, getAutopilotConfig } from "@/lib/services/autopilot";
import { isConfigured as isAiConfigured, activeProvider, MODEL_ROUTING } from "@/lib/ai/provider";
import {
  isEmailConfigured,
  activeEmailProvider,
  canReceiveReplies,
} from "@/lib/outreach/provider";
import { isCalendarConfigured, activeCalendarProvider } from "@/lib/services/bookings";
import { hasIngestionSource, availableSources } from "@/lib/ingest/sources";
import { localParts } from "@/lib/outreach/sendability";

/**
 * §63 / §107 — one place that answers "what is automation allowed to do here,
 * and what has it done?"
 *
 * Deliberately assembled from the same sources the enforcing code reads: the
 * guardrail settings, the provider checks, the tool registry and the recorded
 * actions. Nothing here is a separate description of the policy that could
 * drift from the policy itself.
 */

export type ApprovalKind = "agent_action" | "message";

/** One thing waiting on a human, whatever produced it. */
export type PendingApproval = {
  id: string;
  kind: ApprovalKind;
  /** READ | WRITE | SPEND | EXTERNAL */
  riskClass: string;
  title: string;
  detail: string | null;
  pointsCost: number;
  /** Whether approving it could actually take effect. */
  executable: boolean;
  /** Why not, when it cannot. */
  blockedBecause: string | null;
  actor: string;
  leadId: string | null;
  leadName: string | null;
  companyName: string | null;
  occurredAt: string;
};

/**
 * Everything awaiting a human decision, in one list.
 *
 * Two different queues existed — agent actions on the Autopilot screen and
 * AI-drafted messages in the Inbox — and someone reviewing work should not
 * have to know which screen a given item happened to land on.
 */
export async function listApprovals(ctx: AuthContext): Promise<PendingApproval[]> {
  const visible = leadVisibilityFilter(ctx);

  const [actions, messages] = await Promise.all([
    db.agentAction.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        requiresApproval: true,
        state: "pending_approval",
      },
      orderBy: { occurredAt: "asc" },
      take: 200,
      include: {
        run: { select: { trigger: true, agent: { select: { name: true } } } },
      },
    }),
    db.message.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        state: "PENDING_APPROVAL",
        deletedAt: null,
        ...(visible.ownerId ? { conversation: { lead: { ownerId: visible.ownerId } } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: {
        conversation: {
          select: {
            leadId: true,
            lead: { select: { person: { select: { fullName: true } } } },
            company: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  // Lead names for agent actions, fetched once and respecting visibility.
  const leadIds = [...new Set(actions.map((a) => a.leadId).filter((id): id is string => !!id))];
  const leads = leadIds.length
    ? await db.lead.findMany({
        where: { id: { in: leadIds }, workspaceId: ctx.workspaceId, ...visible },
        select: {
          id: true,
          person: { select: { fullName: true } },
          company: { select: { name: true } },
        },
      })
    : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const fromActions: PendingApproval[] = actions
    // An action on a lead the caller cannot see is not theirs to approve.
    .filter((a) => !a.leadId || leadById.has(a.leadId))
    .map((a) => {
      const health = toolHealth(a.tool);
      const lead = a.leadId ? leadById.get(a.leadId) : undefined;
      return {
        id: a.id,
        kind: "agent_action" as const,
        riskClass: a.riskClass,
        title: a.summary,
        detail: `${a.tool} · triggered by ${a.run.trigger}`,
        pointsCost: a.pointsSpent,
        executable: health.implemented,
        blockedBecause: health.implemented
          ? null
          : health.known
            ? `"${a.tool}" is declared but not built yet, so approving it would do nothing.`
            : `"${a.tool}" is not a tool this app defines.`,
        actor: a.run.agent.name,
        leadId: a.leadId,
        leadName: lead?.person.fullName ?? null,
        companyName: lead?.company.name ?? null,
        occurredAt: a.occurredAt.toISOString(),
      };
    });

  const emailReady = isEmailConfigured();
  const fromMessages: PendingApproval[] = messages.map((m) => ({
    id: m.id,
    kind: "message" as const,
    riskClass: "EXTERNAL",
    title: m.subject ?? "Message with no subject",
    detail: m.body.replace(/\s+/g, " ").trim().slice(0, 200),
    pointsCost: 0,
    executable: emailReady,
    blockedBecause: emailReady
      ? null
      : "No mailbox is connected, so approving would queue a send that cannot drain.",
    actor: m.generatedByAi ? (m.aiModel ?? "AI draft") : "Drafted by hand",
    leadId: m.conversation.leadId,
    leadName: m.conversation.lead?.person.fullName ?? null,
    companyName: m.conversation.company?.name ?? null,
    occurredAt: m.createdAt.toISOString(),
  }));

  return [...fromActions, ...fromMessages].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt)
  );
}

/**
 * What a bulk approval would actually do, itemised, before it is done.
 *
 * "Approve all" is the most dangerous button in the product, so it is the one
 * place that must describe its own consequences: how many will run, how many
 * cannot, and exactly how many points leave the account.
 */
export function summariseApprovals(pending: PendingApproval[]) {
  const runnable = pending.filter((p) => p.executable);
  const blocked = pending.filter((p) => !p.executable);

  return {
    total: pending.length,
    willRun: runnable.length,
    cannotRun: blocked.length,
    pointsAtStake: runnable.reduce((n, p) => n + p.pointsCost, 0),
    byRisk: runnable.reduce<Record<string, number>>((acc, p) => {
      acc[p.riskClass] = (acc[p.riskClass] ?? 0) + 1;
      return acc;
    }, {}),
    /** Named so a reviewer can see who they are about to contact. */
    companies: [...new Set(runnable.map((p) => p.companyName).filter(Boolean))] as string[],
    blockedReasons: [...new Set(blocked.map((p) => p.blockedBecause).filter(Boolean))] as string[],
  };
}

/**
 * The trust summary: permissions, connected services, limits and what
 * automation has actually done lately.
 */
export async function getTrustSummary(ctx: AuthContext) {
  const config = await getAutopilotConfig(ctx);
  const since = startOfLocalDay(ctx.workspace.timezone);

  const [agents, todayActions, recentActions, spendToday, member] = await Promise.all([
    db.aIAgent.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: { name: true, kind: true, isEnabled: true, tools: true, approvalPolicy: true },
      orderBy: { kind: "asc" },
    }),
    db.agentAction.groupBy({
      by: ["riskClass", "state"],
      where: { workspaceId: ctx.workspaceId, occurredAt: { gte: since } },
      _count: { _all: true },
      _sum: { pointsSpent: true },
    }),
    db.agentAction.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { occurredAt: "desc" },
      take: 20,
      include: { run: { select: { agent: { select: { name: true } } } } },
    }),
    db.pointLedger.aggregate({
      where: {
        workspaceId: ctx.workspaceId,
        createdAt: { gte: since },
        actorType: { in: ["AI", "SYSTEM"] },
        delta: { lt: 0 },
      },
      _sum: { delta: true },
    }),
    db.workspaceMember.findFirst({
      where: { workspaceId: ctx.workspaceId, userId: ctx.userId, deletedAt: null },
      select: { role: { select: { name: true, permissions: true } } },
    }),
  ]);

  /**
   * Which tools automation could reach at all. An agent's grant is only half
   * the story — a granted tool that is not built cannot be used by anyone.
   */
  const granted = [...new Set(agents.filter((a) => a.isEnabled).flatMap((a) => a.tools))];
  const reachable = granted.filter((t) => toolHealth(t).implemented);

  const services = [
    {
      name: "Model provider",
      connected: isAiConfigured(),
      detail: isAiConfigured()
        ? `${activeProvider()} — ${MODEL_ROUTING[activeProvider()].reasoning} for reasoning, ${MODEL_ROUTING[activeProvider()].fast} for classification`
        : "Nothing connected, so no agent can decide anything and generated text is unavailable.",
      grants: "Reads your lead, deal and message data to answer questions and draft copy.",
    },
    {
      name: "Email",
      connected: isEmailConfigured(),
      detail: isEmailConfigured()
        ? `${activeEmailProvider()}${canReceiveReplies() ? " — can read replies, so stop-on-reply is automatic" : " — send only, so stop-on-reply cannot be automatic"}`
        : "Nothing connected. Nothing can be sent, and no replies can arrive.",
      grants: "Sends on your behalf and reads replies to the threads it started.",
    },
    {
      name: "Calendar",
      connected: isCalendarConfigured(),
      detail: isCalendarConfigured()
        ? `${activeCalendarProvider()}`
        : "Nothing connected. Meetings are recorded here but no event or invite is created.",
      grants: "Creates events and reads free/busy.",
    },
    {
      name: "Lead discovery",
      connected: hasIngestionSource(),
      detail: hasIngestionSource()
        ? `${availableSources().length} source(s) available`
        : "Only manual import, which needs nothing external. No discovery source is connected.",
      grants: "Fetches public signals and company data.",
    },
  ];

  const aiSpendToday = Math.abs(spendToday._sum.delta ?? 0);

  return {
    mode: config.settings.mode,
    policy: config.policy,
    aiConfigured: config.aiConfigured,
    services,
    limits: {
      pointsPerDay: config.settings.maxPointsPerDay,
      pointsUsedToday: aiSpendToday,
      emailsPerDay: config.settings.maxEmailsPerDay,
      whatsappPerDay: config.settings.maxWhatsappPerDay,
      linkedinPerDay: config.settings.maxLinkedinPerDay,
      revealsPerDay: config.settings.maxRevealsPerDay,
      requireApprovalForSpend: config.settings.requireApprovalForSpend,
      approvalThresholdInr: config.settings.approvalThresholdInr,
    },
    reach: {
      agentsEnabled: agents.filter((a) => a.isEnabled).length,
      agentsTotal: agents.length,
      toolsGranted: granted.length,
      /**
       * The honest number: what automation can actually do today, as opposed
       * to what it has been given permission to do.
       */
      toolsReachable: reachable.length,
      reachableNames: reachable,
      alwaysAsks: agents.filter((a) => a.approvalPolicy === "review_first").map((a) => a.name),
    },
    today: todayActions.map((t) => ({
      riskClass: t.riskClass,
      state: t.state,
      count: t._count._all,
      points: t._sum.pointsSpent ?? 0,
    })),
    recent: recentActions.map((a) => ({
      id: a.id,
      tool: a.tool,
      riskClass: a.riskClass,
      summary: a.summary,
      state: a.state,
      pointsSpent: a.pointsSpent,
      agent: a.run.agent.name,
      occurredAt: a.occurredAt.toISOString(),
      executable: toolHealth(a.tool).implemented,
    })),
    /** The caller's own role, so "what am I allowed to approve" is answerable. */
    you: {
      role: member?.role.name ?? "Unknown",
      canApprove: ctx.permissions.includes(PERMISSIONS.OUTREACH_APPROVE),
      canConfigure: ctx.permissions.includes(PERMISSIONS.AUTOPILOT_CONFIGURE),
      permissionCount: member?.role.permissions.length ?? 0,
      ofPossible: Object.values(PERMISSIONS).length,
    },
    roleCatalogue: Object.entries(SYSTEM_ROLES).map(([key, r]) => ({
      key,
      name: r.name,
      canApprove: r.permissions.includes(PERMISSIONS.OUTREACH_APPROVE),
      canConfigure: r.permissions.includes(PERMISSIONS.AUTOPILOT_CONFIGURE),
    })),
  };
}

function startOfLocalDay(timezone: string): Date {
  const now = new Date();
  const { hour, minute } = localParts(now, timezone);
  return new Date(now.getTime() - (hour * 60 + minute) * 60_000);
}

/** Per-agent detail for the agents screen, including its own run history. */
export async function getAgentDetail(ctx: AuthContext, agentId: string) {
  const agent = await db.aIAgent.findFirst({
    where: { id: agentId, workspaceId: ctx.workspaceId, deletedAt: null },
    include: {
      runs: {
        orderBy: { startedAt: "desc" },
        take: 20,
        include: {
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
              occurredAt: true,
            },
          },
        },
      },
    },
  });
  if (!agent) return null;

  return {
    id: agent.id,
    kind: agent.kind,
    name: agent.name,
    goal: agent.goal,
    isEnabled: agent.isEnabled,
    approvalPolicy: agent.approvalPolicy,
    dailyPointBudget: agent.dailyPointBudget,
    dailyActionCap: agent.dailyActionCap,
    tools: agent.tools.map((name) => ({ name, ...toolHealth(name) })),
    runs: agent.runs.map((r) => ({
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
      actions: r.actions.map((a) => ({
        ...a,
        occurredAt: a.occurredAt.toISOString(),
        executable: toolHealth(a.tool).implemented,
      })),
    })),
  };
}
