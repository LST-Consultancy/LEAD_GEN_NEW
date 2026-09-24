import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { MutationError, loadScoped } from "@/lib/services/mutate";
import { TOOLS, type Tool, type ToolResult } from "@/lib/ai/tools";
import { isEmailConfigured } from "@/lib/outreach/provider";
import { localParts } from "@/lib/outreach/sendability";
import {
  evaluate,
  type AgentSettings,
  type ProposedAction,
  type Verdict,
} from "@/lib/autopilot/guardrails";
import { getAutopilotConfig, decideOnAgentAction } from "@/lib/services/autopilot";
import { decideOnMessage } from "@/lib/services/inbox-mutations";
import { listApprovals, summariseApprovals } from "@/lib/services/trust";
import { emitWebhookEvent } from "@/lib/services/webhook-events";

/**
 * Running a tool as an agent.
 *
 * This is the only path by which an agent changes anything, and it is
 * deliberately narrow:
 *
 *   1. validate the input against the tool's own schema
 *   2. price it, *before* deciding — the guardrails need the cost
 *   3. evaluate the guardrails
 *   4. act, hold, defer or refuse — and record what happened either way
 *
 * Step 4 always writes an `AgentAction`. A refusal is as much a fact worth
 * keeping as a success: without it, "the agent did nothing" and "the agent was
 * stopped for a reason" look identical when someone comes back to ask.
 *
 * The tool's `execute` delegates to the ordinary mutation service, so the
 * permission check, tenant scoping, audit row and activity row are the same
 * ones a human gets. An agent is not a second way into the database.
 */

const TOOL_INDEX = new Map(TOOLS.map((t) => [t.name, t]));

export type RunOutcome = {
  disposition: Verdict["disposition"];
  actionId: string;
  runId: string;
  /** Present only when the tool actually ran. */
  result: ToolResult | null;
  /** Why it did not run, when it did not. */
  guards: Verdict["guards"];
  note: string;
};

async function resolveLeadForTargeting(ctx: AuthContext, leadId: string | undefined) {
  if (!leadId) return undefined;

  const lead = await db.lead.findFirst({
    where: {
      id: leadId,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...leadVisibilityFilter(ctx),
    },
    select: {
      tier: true,
      company: { select: { name: true, industry: true, state: true, domain: true } },
      score: { select: { composite: true } },
    },
  });
  if (!lead) return undefined;

  const suppressed = lead.company.domain
    ? (await db.suppression.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          kind: "domain",
          value: lead.company.domain.toLowerCase(),
        },
        select: { id: true },
      })) !== null
    : false;

  return {
    tier: lead.tier,
    scoreOutOf100: lead.score?.composite ?? 0,
    industry: lead.company.industry,
    location: lead.company.state,
    companyName: lead.company.name,
    domain: lead.company.domain,
    isSuppressed: suppressed,
  };
}

/** Today's usage for this agent, counted from recorded actions. */
async function usageToday(ctx: AuthContext, agentId: string) {
  const now = new Date();
  const { hour, minute } = localParts(now, ctx.workspace.timezone);
  const since = new Date(now.getTime() - (hour * 60 + minute) * 60_000);

  const actions = await db.agentAction.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      occurredAt: { gte: since },
      // Only what actually happened counts against a budget. A refusal costs
      // nothing and must not consume the day's allowance.
      state: { in: ["completed", "approved"] },
      run: { agentId },
    },
    select: { pointsSpent: true, tool: true, riskClass: true, input: true },
  });

  const channelOf = (input: unknown) =>
    (input as { channel?: string } | null)?.channel ?? "EMAIL";

  return {
    points: actions.reduce((n, a) => n + a.pointsSpent, 0),
    actions: actions.length,
    emails: actions.filter((a) => a.riskClass === "EXTERNAL" && channelOf(a.input) === "EMAIL")
      .length,
    whatsapp: actions.filter(
      (a) => a.riskClass === "EXTERNAL" && channelOf(a.input) === "WHATSAPP"
    ).length,
    linkedin: actions.filter(
      (a) => a.riskClass === "EXTERNAL" && channelOf(a.input) === "LINKEDIN"
    ).length,
    leads: 0,
    reveals: actions.filter((a) => a.tool === "unlock_contacts").length,
  };
}

async function nextSequence(runId: string): Promise<number> {
  const last = await db.agentAction.findFirst({
    where: { runId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (last?.sequence ?? 0) + 1;
}

export async function runToolAsAgent(
  ctx: AuthContext,
  opts: {
    agentId: string;
    tool: string;
    input: unknown;
    /** Reuse an open run, or start one. */
    runId?: string;
    trigger?: string;
    /**
     * Set only by `executeApprovedAction`. Satisfies the approval-scoped
     * guards without touching any of the safety ones.
     */
    alreadyApproved?: boolean;
  }
): Promise<RunOutcome> {
  const agent = await loadScoped(
    () =>
      db.aIAgent.findFirst({
        where: { id: opts.agentId, workspaceId: ctx.workspaceId, deletedAt: null },
      }),
    "That agent"
  );

  const tool: Tool | undefined = TOOL_INDEX.get(opts.tool);

  // Validate first. An input the tool would reject must not produce a
  // guardrail verdict, because the verdict would be about an action that could
  // never have happened.
  let input: unknown = opts.input;
  if (tool?.input) {
    const parsed = tool.input.safeParse(opts.input);
    if (!parsed.success) {
      throw new MutationError(
        `That input is not valid for "${opts.tool}": ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`,
        "invalid_tool_input",
        422
      );
    }
    input = parsed.data;
  }

  const config = await getAutopilotConfig(ctx);
  const lead = await resolveLeadForTargeting(
    ctx,
    tool?.leadIdOf?.(input) ?? (input as { leadId?: string } | null)?.leadId
  );

  // Priced before the decision. Doing it after would mean approving a spend
  // whose size nobody knew.
  let pointsCost = 0;
  if (tool?.priceOf && tool.riskClass === "SPEND") {
    try {
      pointsCost = await tool.priceOf(ctx, input);
    } catch {
      // A quote that cannot be produced is not a reason to spend blind.
      throw new MutationError(
        `Could not work out what "${opts.tool}" would cost, so it was not run.`,
        "price_unknown",
        422
      );
    }
  }

  const agentSettings: AgentSettings = {
    kind: agent.kind,
    name: agent.name,
    isEnabled: agent.isEnabled,
    tools: agent.tools,
    approvalPolicy: agent.approvalPolicy,
    dailyPointBudget: agent.dailyPointBudget,
    dailyActionCap: agent.dailyActionCap,
  };

  const action: ProposedAction = {
    tool: opts.tool,
    riskClass: tool?.riskClass ?? "WRITE",
    pointsCost,
    channel: (input as { channel?: string } | null)?.channel,
    valueInr: (input as { valueInr?: number } | null)?.valueInr,
    lead,
  };

  const { weekday, hour } = localParts(new Date(), ctx.workspace.timezone);
  const verdict = evaluate({
    autopilot: config.settings,
    agent: agentSettings,
    action,
    usedToday: await usageToday(ctx, agent.id),
    tool: tool ? { known: true, implemented: tool.implemented } : { known: false, implemented: false },
    providerReady: isEmailConfigured(),
    localWeekday: weekday,
    localHour: hour,
    alreadyApproved: opts.alreadyApproved ?? false,
  });

  // One run per call unless the caller is batching.
  const run = opts.runId
    ? await db.agentRun.findFirstOrThrow({
        where: { id: opts.runId, workspaceId: ctx.workspaceId },
      })
    : await db.agentRun.create({
        data: {
          workspaceId: ctx.workspaceId,
          agentId: agent.id,
          trigger: opts.trigger ?? "manual",
          state: "RUNNING",
          idempotencyKey: randomUUID(),
        },
      });

  const sequence = await nextSequence(run.id);
  const summary = describeAction(opts.tool, input, lead?.companyName);

  // ---- Act, hold, defer or refuse --------------------------------------
  if (verdict.disposition === "allow") {
    let result: ToolResult;
    try {
      result = tool?.run
        ? await tool.run(ctx)
        : await tool!.execute!(ctx, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The tool failed.";
      await db.agentAction.create({
        data: {
          workspaceId: ctx.workspaceId,
          runId: run.id,
          sequence,
          riskClass: action.riskClass,
          tool: opts.tool,
          summary,
          input: input as never,
          output: { error: message } as never,
          state: "failed",
          leadId: lead ? ((input as { leadId?: string }).leadId ?? null) : null,
        },
      });
      await finishRun(run.id);
      throw err;
    }

    const record = await db.agentAction.create({
      data: {
        workspaceId: ctx.workspaceId,
        runId: run.id,
        sequence,
        riskClass: action.riskClass,
        tool: opts.tool,
        summary,
        input: input as never,
        output: result as never,
        state: "completed",
        pointsSpent: pointsCost,
        leadId: (input as { leadId?: string }).leadId ?? null,
      },
    });
    await finishRun(run.id, { taken: 1, points: pointsCost });

    return {
      disposition: "allow",
      actionId: record.id,
      runId: run.id,
      result,
      guards: [],
      note: result.text,
    };
  }

  if (verdict.disposition === "approve") {
    const record = await db.agentAction.create({
      data: {
        workspaceId: ctx.workspaceId,
        runId: run.id,
        sequence,
        riskClass: action.riskClass,
        tool: opts.tool,
        summary,
        // The input is kept so approving can execute the *same* action later,
        // rather than something recomputed from a world that has moved on.
        input: input as never,
        state: "pending_approval",
        requiresApproval: true,
        pointsSpent: pointsCost,
        leadId: (input as { leadId?: string }).leadId ?? null,
      },
    });
    await finishRun(run.id, { held: 1 });
    await emitWebhookEvent(ctx.workspaceId, "agent.action_held", { actionId: record.id, runId: run.id, tool: opts.tool, riskClass: action.riskClass, summary });

    return {
      disposition: "approve",
      actionId: record.id,
      runId: run.id,
      result: null,
      guards: verdict.guards,
      note: `Held for approval: ${verdict.headline?.message ?? "a person must confirm this."}`,
    };
  }

  const record = await db.agentAction.create({
    data: {
      workspaceId: ctx.workspaceId,
      runId: run.id,
      sequence,
      riskClass: action.riskClass,
      tool: opts.tool,
      summary,
      input: input as never,
      output: { guards: verdict.guards } as never,
      // A deferral will be retried; a refusal will not. Keeping them apart is
      // what lets someone tell "waiting" from "never".
      state: verdict.disposition === "defer" ? "deferred" : "refused",
      pointsSpent: 0,
      leadId: (input as { leadId?: string }).leadId ?? null,
    },
  });
  await finishRun(run.id);

  return {
    disposition: verdict.disposition,
    actionId: record.id,
    runId: run.id,
    result: null,
    guards: verdict.guards,
    note: verdict.headline?.message ?? "Not permitted.",
  };
}

async function finishRun(
  runId: string,
  counts: { taken?: number; held?: number; points?: number } = {}
) {
  await db.agentRun.update({
    where: { id: runId },
    data: {
      state: "SUCCEEDED",
      finishedAt: new Date(),
      actionsTaken: { increment: counts.taken ?? 0 },
      actionsHeld: { increment: counts.held ?? 0 },
      pointsSpent: { increment: counts.points ?? 0 },
    },
  });
}

/**
 * Executes an action a person approved.
 *
 * The guardrails run **again** here, which is the promise the approval note
 * makes. Time passes between approving and executing, and in that window the
 * lead may have been suppressed, the budget may have been used up by another
 * agent, or the send window may have closed. Approving is permission to act,
 * not an exemption from the rules.
 */
export async function executeApprovedAction(ctx: AuthContext, actionId: string) {
  const record = await loadScoped(
    () =>
      db.agentAction.findFirst({
        where: { id: actionId, workspaceId: ctx.workspaceId },
        include: { run: { select: { id: true, agentId: true } } },
      }),
    "That action"
  );

  if (record.state !== "approved") {
    throw new MutationError(
      `This action is ${record.state.replace(/_/g, " ")}, not approved, so there is nothing to run.`,
      "not_approved",
      409
    );
  }

  const tool = TOOL_INDEX.get(record.tool);
  if (!tool?.implemented) {
    throw new MutationError(
      `"${record.tool}" cannot run: it is ${tool ? "declared but not built yet" : "not a tool this app defines"}.`,
      "not_executable",
      422
    );
  }

  // Re-evaluate against the world as it is now.
  const outcome = await runToolAsAgent(ctx, {
    agentId: record.run.agentId,
    tool: record.tool,
    input: record.input,
    trigger: `approved:${actionId}`,
    alreadyApproved: true,
  });

  await db.agentAction.update({
    where: { id: actionId },
    data: {
      state: outcome.disposition === "allow" ? "executed" : "blocked_after_approval",
      output: { supersededBy: outcome.actionId, disposition: outcome.disposition } as never,
    },
  });

  return {
    ...outcome,
    note:
      outcome.disposition === "allow"
        ? outcome.note
        : `Approved, but blocked when it came to run: ${outcome.note} Nothing was done.`,
  };
}

/** A short, human sentence for the action log. */
function describeAction(tool: string, input: unknown, company: string | undefined): string {
  const target = company ? ` at ${company}` : "";
  const i = input as Record<string, unknown>;

  switch (tool) {
    case "add_note":
      return `Write a note${target}: "${String(i.body ?? "").slice(0, 80)}"`;
    case "create_task":
      return `Create the task "${String(i.title ?? "")}"${target}`;
    case "update_deal":
      return `Update a deal${target}`;
    case "unlock_contacts":
      return `Reveal contact details${target}`;
    default:
      return `Run ${tool}${target}`;
  }
}

/**
 * Approve and run, in one step.
 *
 * Kept together on purpose. The approval queue previously said an approved
 * action would run "on the agent's next pass" — but with no model provider
 * there is no pass, so an approved action sat in the queue forever looking
 * done. Approving is the person saying yes; the thing they said yes to should
 * then happen, and the guardrails are re-checked at that moment so approval
 * is permission rather than an exemption.
 *
 * Lives here rather than in `autopilot.ts` to keep the import one-way: that
 * module knows nothing about execution.
 */
export async function approveAndRun(ctx: AuthContext, actionId: string) {
  const decision = await decideOnAgentAction(ctx, actionId, { decision: "approve" });

  let outcome: Awaited<ReturnType<typeof executeApprovedAction>>;
  try {
    outcome = await executeApprovedAction(ctx, actionId);
  } catch (err) {
    // The approval stands and is on the audit trail; the run failed. Say both,
    // rather than rolling back a decision a person actually made.
    return {
      approved: true,
      ran: false,
      disposition: "refuse" as const,
      note: `Approved, but it could not run: ${err instanceof Error ? err.message : "the tool failed."}`,
      action: decision.action,
    };
  }

  return {
    approved: true,
    ran: outcome.disposition === "allow",
    disposition: outcome.disposition,
    note: outcome.note,
    action: decision.action,
  };
}

/**
 * Approving everything in the queue.
 *
 * The most dangerous control in the product, so it behaves accordingly:
 *
 *  - it only touches what *would actually run*; items whose tool is unbuilt or
 *    whose provider is missing are left alone rather than marked approved and
 *    quietly dropped
 *  - it reports per item, so a partial failure is visible instead of averaged
 *    into a success message
 *  - it never continues past a hard error on an item; the rest stay queued
 *
 * The caller is expected to have shown `summariseApprovals` first — that is
 * what turns "approve all" from a guess into a decision.
 */
export async function approveAllPending(
  ctx: AuthContext,
  opts: { ids?: string[] } = {}
): Promise<{
  approved: number;
  ran: number;
  skipped: { id: string; title: string; reason: string }[];
  failed: { id: string; title: string; reason: string }[];
  note: string;
}> {
  const pending = await listApprovals(ctx);
  const chosen = opts.ids ? pending.filter((p) => opts.ids!.includes(p.id)) : pending;

  const skipped: { id: string; title: string; reason: string }[] = [];
  const failed: { id: string; title: string; reason: string }[] = [];
  let approved = 0;
  let ran = 0;

  for (const item of chosen) {
    if (!item.executable) {
      // Deliberately left queued. Marking it approved would record a decision
      // that had no effect.
      skipped.push({
        id: item.id,
        title: item.title,
        reason: item.blockedBecause ?? "It could not take effect.",
      });
      continue;
    }

    try {
      if (item.kind === "message") {
        await decideOnMessage(ctx, item.id, { decision: "approve" });
        approved += 1;
        ran += 1;
      } else {
        const result = await approveAndRun(ctx, item.id);
        approved += 1;
        if (result.ran) ran += 1;
        else failed.push({ id: item.id, title: item.title, reason: result.note });
      }
    } catch (err) {
      failed.push({
        id: item.id,
        title: item.title,
        reason: err instanceof Error ? err.message : "It failed.",
      });
    }
  }

  const summary = summariseApprovals(chosen);
  const parts: string[] = [];
  if (ran > 0) parts.push(`${ran} ran`);
  if (approved > ran) parts.push(`${approved - ran} approved but blocked when it came to run`);
  if (skipped.length > 0) parts.push(`${skipped.length} left queued because nothing would happen`);
  if (failed.length > 0) parts.push(`${failed.length} failed`);
  if (summary.pointsAtStake > 0) parts.push(`${summary.pointsAtStake} points spent`);

  return {
    approved,
    ran,
    skipped,
    failed,
    note: parts.length > 0 ? `${parts.join(", ")}.` : "Nothing in the queue could run.",
  };
}
