import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import {
  getAutopilotConfig,
  updateAutopilotConfig,
  listAgents,
  setAgentEnabled,
  dryRunAgent,
  listPendingActions,
  decideOnAgentAction,
  listAgentRuns,
  toolHealth,
  type AutopilotInput,
} from "@/lib/services/autopilot";
import { ForbiddenError } from "@/lib/auth/context";
import { TOOLS } from "@/lib/ai/tools";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Autopilot");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

function withAi() {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
}

/**
 * Pretends no model provider is connected.
 *
 * Needed explicitly: these tests previously relied on the developer's `.env`
 * having no key, so the moment a real one was added they started asserting the
 * opposite of what they meant. A test about the unconfigured path has to
 * *state* that it is unconfigured.
 */
function withoutAi() {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GOOGLE_API_KEY", "");
}

const CONFIG: AutopilotInput = {
  mode: "REVIEW_FIRST",
  maxLeadsPerDay: 20,
  maxRevealsPerDay: 5,
  maxPointsPerDay: 25,
  maxEmailsPerDay: 30,
  maxWhatsappPerDay: 10,
  maxLinkedinPerDay: 10,
  allowedTiers: ["A", "B"],
  minScore: 70,
  allowedChannels: ["EMAIL"],
  sendWindowStart: 9,
  sendWindowEnd: 19,
  sendDays: [1, 2, 3, 4, 5],
  approvalThresholdInr: 0,
  requireApprovalForSpend: true,
};

/** An agent with tools that exist and are built. */
async function makeAgent(
  workspaceId: string,
  over: {
    kind?: string;
    tools?: string[];
    isEnabled?: boolean;
    approvalPolicy?: string;
    dailyPointBudget?: number;
    dailyActionCap?: number;
  } = {}
) {
  return db.aIAgent.create({
    data: {
      workspaceId,
      kind: (over.kind ?? "RESEARCH") as never,
      name: over.kind === "SDR" ? "SDR agent" : "Research agent",
      goal: "Do a useful thing.",
      isEnabled: over.isEnabled ?? false,
      tools: over.tools ?? ["get_today", "search_leads"],
      approvalPolicy: over.approvalPolicy ?? "auto_within_budget",
      dailyPointBudget: over.dailyPointBudget ?? 10,
      dailyActionCap: over.dailyActionCap ?? 20,
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("configuration", () => {
  it("returns defaults but says nothing has been configured", async () => {
    withoutAi();
    const { ctx } = await freshWorkspace();
    const config = await getAutopilotConfig(ctx);
    expect(config.configured).toBe(false);
    expect(config.settings.mode).toBe("OFF");
    expect(config.policy[0]).toMatch(/cannot change or send anything/);
  });

  it("leads with the fact that no model provider is connected", async () => {
    withoutAi();
    const { ctx } = await freshWorkspace();
    const config = await getAutopilotConfig(ctx);
    expect(config.aiConfigured).toBe(false);
    expect(config.aiMessage).toMatch(/No AI provider is configured/);
  });

  it("refuses full-auto with no model provider, because nothing would act", async () => {
    withoutAi();
    const { ctx } = await freshWorkspace();
    await expect(
      updateAutopilotConfig(ctx, { ...CONFIG, mode: "FULL_AUTO" })
    ).rejects.toThrow(/would misrepresent what the system does/);
  });

  it("allows full-auto once a provider exists", async () => {
    withAi();
    const { ctx } = await freshWorkspace();
    const result = await updateAutopilotConfig(ctx, { ...CONFIG, mode: "FULL_AUTO" });
    expect(result.settings.mode).toBe("FULL_AUTO");
    expect(result.note).toMatch(/without asking/);
  });

  it("refuses a window that never opens", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      updateAutopilotConfig(ctx, { ...CONFIG, sendWindowStart: 19, sendWindowEnd: 9 })
    ).rejects.toThrow(/nothing would ever send/);
  });

  it("refuses being on with no tiers selected", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      updateAutopilotConfig(ctx, { ...CONFIG, allowedTiers: [] })
    ).rejects.toThrow(/able to touch nothing/);
  });

  it("refuses being on with no sending days, which would look like a stall", async () => {
    const { ctx } = await freshWorkspace();
    await expect(updateAutopilotConfig(ctx, { ...CONFIG, sendDays: [] })).rejects.toThrow(
      /looks like a stall/
    );
  });

  it("mirrors the mode onto the workspace the shell badge reads", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, CONFIG);
    const after = await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    expect(after.autopilotMode).toBe("REVIEW_FIRST");
  });

  it("describes the saved policy in words the evaluator would enforce", async () => {
    const { ctx } = await freshWorkspace();
    const result = await updateAutopilotConfig(ctx, CONFIG);
    const text = result.policy.join(" ");
    expect(text).toMatch(/waits for a person/);
    expect(text).toMatch(/tier A and B leads scoring 70 or above/);
    expect(text).toMatch(/costs points needs approval/);
  });

  it("requires the configure permission", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    await expect(updateAutopilotConfig(rep, CONFIG)).rejects.toThrow(ForbiddenError);
    void ctx;
  });

  it("does not leak another workspace's config", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await updateAutopilotConfig(b.ctx, CONFIG);
    expect((await getAutopilotConfig(a.ctx)).configured).toBe(false);
    expect((await getAutopilotConfig(b.ctx)).configured).toBe(true);
  });
});

describe("tool health", () => {
  it("knows which registry tools are built", () => {
    expect(toolHealth("get_today")).toMatchObject({ known: true, implemented: true });
    expect(toolHealth("add_note")).toMatchObject({ known: true, implemented: true });
    // Still declared and unbuilt: there is no transport for either.
    expect(toolHealth("send_email")).toMatchObject({ known: true, implemented: false });
    expect(toolHealth("send_whatsapp")).toMatchObject({ known: true, implemented: false });
  });

  it("reports an undefined tool as unknown rather than guessing", () => {
    expect(toolHealth("find_leads")).toEqual({
      known: false,
      implemented: false,
      riskClass: null,
    });
  });

  it("every registry tool has a risk class", () => {
    for (const t of TOOLS) {
      expect(["READ", "WRITE", "SPEND", "EXTERNAL"]).toContain(t.riskClass);
    }
  });
});

describe("agents", () => {
  it("separates unknown tools from declared-but-unbuilt ones", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeAgent(workspace.id, {
      tools: ["get_today", "send_email", "find_leads"],
    });

    const [agent] = await listAgents(ctx);
    expect(agent.health.usable).toBe(1);
    expect(agent.health.unbuilt).toEqual(["send_email"]);
    expect(agent.health.unknown).toEqual(["find_leads"]);
    expect(agent.health.inert).toBe(false);
  });

  it("calls an agent inert when nothing it has is usable", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeAgent(workspace.id, { tools: ["find_leads", "add_lead"] });
    const [agent] = await listAgents(ctx);
    expect(agent.health.inert).toBe(true);
    expect(agent.health.usable).toBe(0);
  });

  it("leads with the model provider as the reason nothing runs", async () => {
    withoutAi();
    const { ctx, workspace } = await freshWorkspace();
    await makeAgent(workspace.id, { isEnabled: true });
    const [agent] = await listAgents(ctx);
    expect(agent.blockedBecause).toMatch(/No model provider is connected/);
  });

  it("names autopilot being off once a provider exists", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await makeAgent(workspace.id, { isEnabled: true });
    const [agent] = await listAgents(ctx);
    expect(agent.blockedBecause).toBe("Autopilot is off.");
  });

  it("reports nothing blocking when everything lines up", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, CONFIG);
    await makeAgent(workspace.id, { isEnabled: true });
    const [agent] = await listAgents(ctx);
    expect(agent.blockedBecause).toBeNull();
  });

  it("refuses to enable an agent that could do nothing", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id, { tools: ["find_leads"] });
    await expect(setAgentEnabled(ctx, agent.id, true)).rejects.toThrow(
      /is not a tool this app defines/
    );
  });

  it("refuses to enable an agent whose tools are all unbuilt", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id, { tools: ["send_email", "send_whatsapp"] });
    await expect(setAgentEnabled(ctx, agent.id, true)).rejects.toThrow(
      /a switch on a feature that does not exist/
    );
  });

  it("enables an agent with a usable tool, but says it still will not run", async () => {
    withoutAi();
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id, { tools: ["get_today"] });
    const result = await setAgentEnabled(ctx, agent.id, true);
    expect(result.agent.isEnabled).toBe(true);
    expect(result.note).toMatch(/still will not run/);
  });

  it("always allows disabling", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id, { tools: ["find_leads"], isEnabled: true });
    const result = await setAgentEnabled(ctx, agent.id, false);
    expect(result.agent.isEnabled).toBe(false);
  });

  it("requires the agents permission", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id, { tools: ["get_today"] });
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    await expect(setAgentEnabled(rep, agent.id, true)).rejects.toThrow(ForbiddenError);
    void ctx;
  });
});

describe("the dry run", () => {
  it("evaluates real leads without writing anything", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, CONFIG);
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A", score: 9 });
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "D", score: 2 });
    const agent = await makeAgent(workspace.id, { isEnabled: true, tools: ["get_today"] });

    const runsBefore = await db.agentRun.count({ where: { workspaceId: workspace.id } });
    const result = await dryRunAgent(ctx, agent.id);

    expect(result.examined).toBe(2);
    // Nothing was recorded: no run, no action.
    expect(await db.agentRun.count({ where: { workspaceId: workspace.id } })).toBe(runsBefore);
    expect(await db.agentAction.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });

  it("names the action it evaluated, so the result is interpretable", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, CONFIG);
    await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, {
      isEnabled: true,
      tools: ["get_today", "send_email"],
    });

    const result = await dryRunAgent(ctx, agent.id);
    // The most consequential tool, not the first or the safest.
    expect(result.consideredAction).toMatchObject({
      tool: "send_email",
      riskClass: "EXTERNAL",
    });
  });

  it("refuses the whole batch when the chosen tool is not built", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, CONFIG);
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A", score: 9 });
    const agent = await makeAgent(workspace.id, { isEnabled: true, tools: ["send_email"] });

    const result = await dryRunAgent(ctx, agent.id);
    expect(result.tally.refuse).toBe(1);
    expect(result.rows[0].guards.map((g) => g.code)).toContain("no_provider");
  });

  it("holds a write for approval in review-first rather than refusing", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, { ...CONFIG, allowedTiers: ["A", "B", "C", "D"] });
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A", score: 9 });
    const agent = await makeAgent(workspace.id, {
      isEnabled: true,
      tools: ["add_note"],
    });

    const result = await dryRunAgent(ctx, agent.id);
    // add_note is a built WRITE tool, so what stops it is the review policy —
    // not a missing implementation.
    expect(result.rows[0].disposition).toBe("approve");
    expect(result.rows[0].guards.map((g) => g.code)).toContain("mode_requires_review");
  });

  it("still refuses a tool that is declared but not built", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, { ...CONFIG, allowedTiers: ["A", "B", "C", "D"] });
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A", score: 9 });
    const agent = await makeAgent(workspace.id, { isEnabled: true, tools: ["send_whatsapp"] });

    const result = await dryRunAgent(ctx, agent.id);
    expect(result.rows[0].guards.map((g) => g.code)).toContain("tool_not_implemented");
  });

  it("refuses a lead below the score minimum and names both numbers", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, CONFIG);
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A", score: 2 });
    const agent = await makeAgent(workspace.id, { isEnabled: true, tools: ["get_today"] });

    const result = await dryRunAgent(ctx, agent.id);
    const guard = result.rows[0].guards.find((g) => g.code === "score_below_minimum");
    expect(guard?.message).toContain("70");
  });

  it("compares the 0-100 composite, not the 0-10 display score", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, { ...CONFIG, allowedTiers: ["A", "B", "C", "D"] });
    // makeLead writes composite = score * 10, so score 9 is composite 90.
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A", score: 9 });
    const agent = await makeAgent(workspace.id, { isEnabled: true, tools: ["get_today"] });

    const result = await dryRunAgent(ctx, agent.id);
    const row = result.rows.find((r) => r.leadId === lead.id)!;
    // 90 clears the minimum of 70. Comparing the display score (9.0) against
    // 70 refused every lead in the workspace.
    expect(row.guards.map((g) => g.code)).not.toContain("score_below_minimum");
    // Fully clear: a READ tool is not held for review, so nothing blocks it.
    expect(row.disposition).toBe("allow");
  });

  it("names the scale in the refusal message", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, { ...CONFIG, allowedTiers: ["A", "B", "C", "D"] });
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A", score: 2 });
    const agent = await makeAgent(workspace.id, { isEnabled: true, tools: ["get_today"] });

    const result = await dryRunAgent(ctx, agent.id);
    const guard = result.rows[0].guards.find((g) => g.code === "score_below_minimum");
    expect(guard?.message).toMatch(/out of 100/);
  });

  it("says plainly that no agent ran", async () => {
    withoutAi();
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id, { tools: ["get_today"] });
    const result = await dryRunAgent(ctx, agent.id);
    expect(result.note).toMatch(/No agent ran and nothing was written/);
    expect(result.note).toMatch(/could not choose what to do in the first place/);
  });

  it("only considers leads the caller can see", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    await updateAutopilotConfig(ctx, CONFIG);
    await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, { isEnabled: true, tools: ["get_today"] });
    const rep = await addMember(workspace.id, "Rep", "sales_rep");

    expect((await dryRunAgent(ctx, agent.id)).examined).toBe(1);
    expect((await dryRunAgent(rep, agent.id)).examined).toBe(0);
  });

  it("does not run against another workspace's agent", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const agent = await makeAgent(b.workspace.id, { tools: ["get_today"] });
    await expect(dryRunAgent(a.ctx, agent.id)).rejects.toThrow(
      /doesn't exist, or you don't have access/
    );
  });
});

describe("the agent approval queue", () => {
  async function pendingAction(
    workspaceId: string,
    over: { tool?: string; riskClass?: string; points?: number } = {}
  ) {
    const agent = await makeAgent(workspaceId, { isEnabled: true, tools: ["get_today"] });
    const run = await db.agentRun.create({
      data: {
        workspaceId,
        agentId: agent.id,
        trigger: "schedule",
        state: "SUCCEEDED",
        actionsHeld: 1,
      },
    });
    return db.agentAction.create({
      data: {
        workspaceId,
        runId: run.id,
        sequence: 1,
        riskClass: over.riskClass ?? "SPEND",
        tool: over.tool ?? "unlock_contacts",
        summary: "Unlock two verified contacts at Vaitarna Steel Works",
        state: "pending_approval",
        requiresApproval: true,
        pointsSpent: over.points ?? 2,
      },
    });
  }

  it("lists what is waiting, with whether approving could take effect", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await pendingAction(workspace.id);

    const [pending] = await listPendingActions(ctx);
    expect(pending.tool).toBe("unlock_contacts");
    expect(pending.riskClass).toBe("SPEND");
    // Built, so approving it can actually take effect.
    expect(pending.executable).toBe(true);
  });

  it("refuses to approve something that would do nothing", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const action = await pendingAction(workspace.id, { tool: "send_whatsapp" });
    await expect(decideOnAgentAction(ctx, action.id, { decision: "approve" })).rejects.toThrow(
      /declared but not built yet/
    );
    // And left it pending rather than half-approving.
    const after = await db.agentAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(after.state).toBe("pending_approval");
  });

  it("says the tool is undefined when that is the problem", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const action = await pendingAction(workspace.id, { tool: "enroll_sequence" });
    await expect(decideOnAgentAction(ctx, action.id, { decision: "approve" })).rejects.toThrow(
      /not a tool this app defines/
    );
  });

  it("approves an action whose tool is built", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const action = await pendingAction(workspace.id, {
      tool: "get_today",
      riskClass: "READ",
      points: 0,
    });

    const result = await decideOnAgentAction(ctx, action.id, { decision: "approve" });
    expect(result.action.state).toBe("approved");
    expect(result.action.approvedById).toBe(ctx.userId);
    // The guardrails run again at execution time, and the note says so.
    expect(result.note).toMatch(/guardrails are re-checked at the moment it runs/);
  });

  it("requires a reason to reject, and keeps it", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const action = await pendingAction(workspace.id);

    await expect(decideOnAgentAction(ctx, action.id, { decision: "reject" })).rejects.toThrow(
      /record of why an agent was overruled/
    );

    const result = await decideOnAgentAction(ctx, action.id, {
      decision: "reject",
      reason: "We already have those contacts.",
    });
    expect(result.action.state).toBe("rejected");

    const audit = await db.auditLog.findFirstOrThrow({
      where: { workspaceId: workspace.id, action: "agent_action.rejected" },
    });
    expect((audit.after as Record<string, unknown>).reason).toMatch(/already have those contacts/);
  });

  it("refuses to decide twice", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const action = await pendingAction(workspace.id);
    await decideOnAgentAction(ctx, action.id, { decision: "reject", reason: "No." });
    await expect(
      decideOnAgentAction(ctx, action.id, { decision: "reject", reason: "Again." })
    ).rejects.toThrow(/not waiting for approval/);
  });

  it("does not show another workspace's queue", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await pendingAction(b.workspace.id);
    expect(await listPendingActions(a.ctx)).toHaveLength(0);
    expect(await listPendingActions(b.ctx)).toHaveLength(1);
  });
});

describe("run history", () => {
  it("lists runs with their actions and whether each could take effect", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id, { isEnabled: true });
    const run = await db.agentRun.create({
      data: {
        workspaceId: workspace.id,
        agentId: agent.id,
        trigger: "manual",
        state: "SUCCEEDED",
        summary: "Looked at 12 leads.",
        actionsTaken: 2,
        pointsSpent: 3,
      },
    });
    await db.agentAction.createMany({
      data: [
        {
          workspaceId: workspace.id,
          runId: run.id,
          sequence: 1,
          riskClass: "READ",
          tool: "get_today",
          summary: "Read the brief",
          state: "completed",
        },
        {
          workspaceId: workspace.id,
          runId: run.id,
          sequence: 2,
          riskClass: "WRITE",
          tool: "add_note",
          summary: "Wrote a note",
          state: "completed",
        },
      ],
    });

    const [listed] = await listAgentRuns(ctx);
    expect(listed.summary).toBe("Looked at 12 leads.");
    expect(listed.actions).toHaveLength(2);
    expect(listed.actions[0]).toMatchObject({ tool: "get_today", executable: true });
    // add_note is built; send_whatsapp is not, and they read differently.
    expect(listed.actions[1]).toMatchObject({ tool: "add_note", executable: true });
  });

  it("does not leak runs across workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const agent = await makeAgent(b.workspace.id);
    await db.agentRun.create({
      data: { workspaceId: b.workspace.id, agentId: agent.id, trigger: "manual", state: "SUCCEEDED" },
    });
    expect(await listAgentRuns(a.ctx)).toHaveLength(0);
    expect(await listAgentRuns(b.ctx)).toHaveLength(1);
  });
});
