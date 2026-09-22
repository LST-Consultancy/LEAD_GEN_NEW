import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, makeWorkspace, makeLead, grantPoints, cleanup } from "./helpers/fixtures";
import {
  runToolAsAgent,
  executeApprovedAction,
  approveAndRun,
} from "@/lib/services/agent-runner";
import { updateAutopilotConfig, decideOnAgentAction, toolHealth } from "@/lib/services/autopilot";
import { TOOLS } from "@/lib/ai/tools";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Runner");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

function withAi() {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
}

const BASE = {
  maxLeadsPerDay: 20,
  maxRevealsPerDay: 5,
  maxPointsPerDay: 25,
  maxEmailsPerDay: 30,
  maxWhatsappPerDay: 10,
  maxLinkedinPerDay: 10,
  allowedTiers: ["A", "B", "C", "D"] as ("A" | "B" | "C" | "D")[],
  minScore: 0,
  allowedChannels: ["EMAIL"] as "EMAIL"[],
  sendWindowStart: 0,
  sendWindowEnd: 24,
  sendDays: [1, 2, 3, 4, 5, 6, 7],
  approvalThresholdInr: 0,
};

async function autoWorkspace(over: { requireApprovalForSpend?: boolean } = {}) {
  withAi();
  const w = await freshWorkspace();
  await updateAutopilotConfig(w.ctx, {
    ...BASE,
    mode: "FULL_AUTO",
    requireApprovalForSpend: over.requireApprovalForSpend ?? false,
  });
  return w;
}

async function makeAgent(workspaceId: string, tools: string[], over: { budget?: number; cap?: number } = {}) {
  return db.aIAgent.create({
    data: {
      workspaceId,
      kind: "RESEARCH",
      name: "Research agent",
      goal: "Do a useful thing.",
      isEnabled: true,
      tools,
      approvalPolicy: "auto_within_budget",
      dailyPointBudget: over.budget ?? 20,
      dailyActionCap: over.cap ?? 50,
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

describe("the write tools are actually built", () => {
  it("reports add_note, create_task, update_deal and unlock_contacts as implemented", () => {
    for (const name of ["add_note", "create_task", "update_deal", "unlock_contacts"]) {
      expect(toolHealth(name)).toMatchObject({ known: true, implemented: true });
    }
  });

  it("every implemented non-READ tool has an input schema and an executor", () => {
    for (const t of TOOLS) {
      if (t.riskClass === "READ" || !t.implemented) continue;
      expect(t.input, `${t.name} needs an input schema`).toBeDefined();
      expect(t.execute, `${t.name} needs an executor`).toBeDefined();
    }
  });

  it("every SPEND tool can price itself before running", () => {
    for (const t of TOOLS) {
      if (t.riskClass !== "SPEND" || !t.implemented) continue;
      expect(t.priceOf, `${t.name} must be priceable before it runs`).toBeDefined();
    }
  });
});

describe("add_note through an agent", () => {
  it("writes a real note and records the action", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["add_note"]);

    const outcome = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Mid-evaluation with two other vendors.", leadId: lead.id },
    });

    expect(outcome.disposition).toBe("allow");
    expect(outcome.result?.text).toBe("Note added.");

    const note = await db.note.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(note.body).toBe("Mid-evaluation with two other vendors.");

    const action = await db.agentAction.findUniqueOrThrow({ where: { id: outcome.actionId } });
    expect(action.state).toBe("completed");
    expect(action.tool).toBe("add_note");
    expect(action.summary).toMatch(/Write a note at/);
  });

  it("goes through the ordinary service, so the audit trail exists", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["add_note"]);

    await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "A note.", leadId: lead.id },
    });

    // The same audit row a human write produces — an agent is not a second
    // way into the database.
    const audit = await db.auditLog.findFirstOrThrow({
      where: { workspaceId: workspace.id, action: "note.created" },
    });
    expect(audit.objectType).toBe("Note");
  });

  it("rejects input the tool's own schema would reject", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const agent = await makeAgent(workspace.id, ["add_note"]);

    // No parent: createNoteSchema refuses it.
    await expect(
      runToolAsAgent(ctx, { agentId: agent.id, tool: "add_note", input: { body: "Orphan" } })
    ).rejects.toThrow(/not valid for "add_note"/);

    // And nothing was recorded, because the action could never have happened.
    expect(await db.agentAction.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });
});

describe("create_task through an agent", () => {
  it("creates a task ranked like any other", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["create_task"]);

    const outcome = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "create_task",
      input: { title: "Send the two-page breakdown", leadId: lead.id },
    });

    expect(outcome.disposition).toBe("allow");
    const task = await db.task.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(task.title).toBe("Send the two-page breakdown");
  });
});

describe("update_deal through an agent", () => {
  it("changes the value and reports the new figure", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const pipeline = await db.pipeline.create({
      data: { workspaceId: workspace.id, name: "P", isDefault: true },
    });
    const stage = await db.pipelineStage.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        key: "qualify",
        name: "Qualify",
        sortOrder: 0,
        probability: 30,
      },
    });
    const deal = await db.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        leadId: lead.id,
        companyId: company.id,
        title: "ERP phase one",
        valueInr: 1_000_000,
        status: "OPEN",
      },
    });
    const agent = await makeAgent(workspace.id, ["update_deal"]);

    const outcome = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "update_deal",
      input: { dealId: deal.id, valueInr: 1_500_000 },
    });

    expect(outcome.disposition).toBe("allow");
    const after = await db.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(Number(after.valueInr)).toBe(1_500_000);
  });
});

describe("unlock_contacts through an agent", () => {
  async function leadWithLockedContact(workspaceId: string, ownerId: string) {
    const { lead, person } = await makeLead(workspaceId, { ownerId });
    await db.contactMethod.create({
      data: {
        workspaceId,
        personId: person.id,
        kind: "WORK_EMAIL",
        value: "priya@vaitarna.example",
        maskedValue: "p•••@vaitarna.example",
        isLocked: true,
        status: "VERIFIED",
        confidence: 92,
        source: "test",
      },
    });
    return lead;
  }

  it("prices the reveal before deciding, and spends what it quoted", async () => {
    const { ctx, workspace } = await autoWorkspace();
    await grantPoints(workspace.id, 50);
    const lead = await leadWithLockedContact(workspace.id, ctx.userId);
    const agent = await makeAgent(workspace.id, ["unlock_contacts"]);

    const outcome = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "unlock_contacts",
      input: { leadId: lead.id },
    });

    expect(outcome.disposition).toBe("allow");
    const action = await db.agentAction.findUniqueOrThrow({ where: { id: outcome.actionId } });
    expect(action.pointsSpent).toBeGreaterThan(0);

    // The ledger agrees with what the action says it spent.
    const ledger = await db.pointLedger.findFirst({
      where: { workspaceId: workspace.id, type: "REVEAL" },
      orderBy: { createdAt: "desc" },
    });
    expect(Math.abs(ledger!.delta)).toBe(action.pointsSpent);
  });

  it("holds a spend for approval when the workspace requires it", async () => {
    const { ctx, workspace } = await autoWorkspace({ requireApprovalForSpend: true });
    await grantPoints(workspace.id, 50);
    const lead = await leadWithLockedContact(workspace.id, ctx.userId);
    const agent = await makeAgent(workspace.id, ["unlock_contacts"]);

    const outcome = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "unlock_contacts",
      input: { leadId: lead.id },
    });

    expect(outcome.disposition).toBe("approve");
    expect(outcome.note).toMatch(/Held for approval/);

    // Nothing was spent and the contact is still locked.
    expect(await db.pointLedger.count({ where: { workspaceId: workspace.id, type: "REVEAL" } })).toBe(0);
    const contact = await db.contactMethod.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(contact.isLocked).toBe(true);

    // And the held action knows what it would have cost.
    const action = await db.agentAction.findUniqueOrThrow({ where: { id: outcome.actionId } });
    expect(action.state).toBe("pending_approval");
    expect(action.pointsSpent).toBeGreaterThan(0);
  });

  it("defers once the budget is used up, counting what it already spent", async () => {
    const { ctx, workspace } = await autoWorkspace();
    await grantPoints(workspace.id, 50);
    const first = await leadWithLockedContact(workspace.id, ctx.userId);
    const second = await leadWithLockedContact(workspace.id, ctx.userId);
    // A budget of 1 permits exactly one point, so the first reveal fits and
    // the second must not.
    const agent = await makeAgent(workspace.id, ["unlock_contacts"], { budget: 1 });

    const one = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "unlock_contacts",
      input: { leadId: first.id },
    });
    expect(one.disposition).toBe("allow");

    const two = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "unlock_contacts",
      input: { leadId: second.id },
    });
    expect(two.disposition).toBe("defer");

    const action = await db.agentAction.findUniqueOrThrow({ where: { id: two.actionId } });
    expect(action.state).toBe("deferred");
    // A deferral costs nothing.
    expect(action.pointsSpent).toBe(0);

    // And the second lead's contact is genuinely still locked.
    const stillLocked = await db.contactMethod.findFirstOrThrow({
      where: { person: { leads: { some: { id: second.id } } } },
    });
    expect(stillLocked.isLocked).toBe(true);
  });
});

describe("recording what did not happen", () => {
  it("records a refusal, so 'did nothing' and 'was stopped' are distinguishable", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId, tier: "D" });
    await updateAutopilotConfig(ctx, {
      ...BASE,
      mode: "FULL_AUTO",
      allowedTiers: ["A"],
      requireApprovalForSpend: false,
    });
    const agent = await makeAgent(workspace.id, ["add_note"]);

    const outcome = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Should not be written.", leadId: lead.id },
    });

    expect(outcome.disposition).toBe("refuse");
    const action = await db.agentAction.findUniqueOrThrow({ where: { id: outcome.actionId } });
    expect(action.state).toBe("refused");
    // And the note genuinely was not written.
    expect(await db.note.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("keeps a deferral separate from a refusal", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["add_note"], { cap: 1 });

    await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "First.", leadId: lead.id },
    });
    const second = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Second.", leadId: lead.id },
    });

    expect(second.disposition).toBe("defer");
    expect(await db.note.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("does not let a refusal consume the daily allowance", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId, tier: "D" });
    await updateAutopilotConfig(ctx, {
      ...BASE,
      mode: "FULL_AUTO",
      allowedTiers: ["A"],
      requireApprovalForSpend: false,
    });
    const agent = await makeAgent(workspace.id, ["add_note"], { cap: 1 });

    // Two refusals, then the cap must still be unspent.
    await runToolAsAgent(ctx, { agentId: agent.id, tool: "add_note", input: { body: "a", leadId: lead.id } });
    await runToolAsAgent(ctx, { agentId: agent.id, tool: "add_note", input: { body: "b", leadId: lead.id } });

    await updateAutopilotConfig(ctx, {
      ...BASE,
      mode: "FULL_AUTO",
      allowedTiers: ["A", "B", "C", "D"],
      requireApprovalForSpend: false,
    });
    const third = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "c", leadId: lead.id },
    });
    expect(third.disposition).toBe("allow");
  });

  it("refuses a tool the agent does not hold", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["create_task"]);

    const outcome = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Not granted.", leadId: lead.id },
    });
    expect(outcome.disposition).toBe("refuse");
    expect(outcome.guards.map((g) => g.code)).toContain("tool_not_granted");
    expect(await db.note.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("refuses when autopilot is off", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["add_note"]);

    const outcome = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Nope.", leadId: lead.id },
    });
    expect(outcome.disposition).toBe("refuse");
    expect(outcome.guards.map((g) => g.code)).toContain("autopilot_off");
  });
});

describe("executing an approved action", () => {
  it("runs the same action that was approved", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["add_note"]);
    await db.aIAgent.update({
      where: { id: agent.id },
      data: { approvalPolicy: "review_first" },
    });

    const held = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Approved later.", leadId: lead.id },
    });
    expect(held.disposition).toBe("approve");

    await decideOnAgentAction(ctx, held.actionId, { decision: "approve" });
    // Back to auto so the re-check passes.
    await db.aIAgent.update({
      where: { id: agent.id },
      data: { approvalPolicy: "auto_within_budget" },
    });

    const run = await executeApprovedAction(ctx, held.actionId);
    expect(run.disposition).toBe("allow");

    const note = await db.note.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(note.body).toBe("Approved later.");

    const original = await db.agentAction.findUniqueOrThrow({ where: { id: held.actionId } });
    expect(original.state).toBe("executed");
  });

  it("re-checks the guardrails, so approval is not an exemption", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A" });
    const agent = await makeAgent(workspace.id, ["add_note"]);
    await db.aIAgent.update({
      where: { id: agent.id },
      data: { approvalPolicy: "review_first" },
    });

    const held = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Should be blocked at execution.", leadId: lead.id },
    });
    await decideOnAgentAction(ctx, held.actionId, { decision: "approve" });

    // The world changes between approving and running.
    await db.aIAgent.update({
      where: { id: agent.id },
      data: { approvalPolicy: "auto_within_budget" },
    });
    await updateAutopilotConfig(ctx, {
      ...BASE,
      mode: "FULL_AUTO",
      allowedTiers: ["D"],
      requireApprovalForSpend: false,
    });

    const run = await executeApprovedAction(ctx, held.actionId);
    expect(run.disposition).toBe("refuse");
    expect(run.note).toMatch(/blocked when it came to run/);
    expect(run.note).toMatch(/Nothing was done/);

    expect(await db.note.count({ where: { leadId: lead.id } })).toBe(0);
    const original = await db.agentAction.findUniqueOrThrow({ where: { id: held.actionId } });
    expect(original.state).toBe("blocked_after_approval");
  });

  it("refuses to run something not approved", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["add_note"]);
    const done = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Already ran.", leadId: lead.id },
    });

    await expect(executeApprovedAction(ctx, done.actionId)).rejects.toThrow(
      /not approved, so there is nothing to run/
    );
  });

  it("will not run across workspaces", async () => {
    const a = await autoWorkspace();
    const b = await autoWorkspace();
    const { lead } = await makeLead(b.workspace.id, { ownerId: b.ctx.userId });
    const agent = await makeAgent(b.workspace.id, ["add_note"]);
    const done = await runToolAsAgent(b.ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Theirs.", leadId: lead.id },
    });

    await expect(executeApprovedAction(a.ctx, done.actionId)).rejects.toThrow(
      /doesn't exist, or you don't have access/
    );
  });
});

describe("tenant scoping", () => {
  it("will not act on a lead in another workspace", async () => {
    const a = await autoWorkspace();
    const b = await autoWorkspace();
    const { lead } = await makeLead(b.workspace.id, { ownerId: b.ctx.userId });
    const agent = await makeAgent(a.workspace.id, ["add_note"]);

    // The tool's own service refuses the out-of-tenant parent.
    await expect(
      runToolAsAgent(a.ctx, {
        agentId: agent.id,
        tool: "add_note",
        input: { body: "Cross-tenant.", leadId: lead.id },
      })
    ).rejects.toThrow();
    expect(await db.note.count({ where: { leadId: lead.id } })).toBe(0);
  });
});

describe("approveAndRun", () => {
  it("approves and actually does the thing", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["add_note"]);
    await db.aIAgent.update({
      where: { id: agent.id },
      data: { approvalPolicy: "review_first" },
    });

    const held = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Approved and run.", leadId: lead.id },
    });
    expect(held.disposition).toBe("approve");

    // Back to auto, the way a person clicking approve expects to be the only
    // remaining gate.
    await db.aIAgent.update({
      where: { id: agent.id },
      data: { approvalPolicy: "auto_within_budget" },
    });

    const result = await approveAndRun(ctx, held.actionId);
    expect(result.approved).toBe(true);
    expect(result.ran).toBe(true);

    const note = await db.note.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(note.body).toBe("Approved and run.");
  });

  it("keeps the approval on record even when the run is then blocked", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A" });
    const agent = await makeAgent(workspace.id, ["add_note"]);
    await db.aIAgent.update({
      where: { id: agent.id },
      data: { approvalPolicy: "review_first" },
    });
    const held = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Blocked later.", leadId: lead.id },
    });

    await db.aIAgent.update({
      where: { id: agent.id },
      data: { approvalPolicy: "auto_within_budget" },
    });
    await updateAutopilotConfig(ctx, {
      ...BASE,
      mode: "FULL_AUTO",
      allowedTiers: ["D"],
      requireApprovalForSpend: false,
    });

    const result = await approveAndRun(ctx, held.actionId);
    // Both facts are reported: the decision happened, the action did not.
    expect(result.approved).toBe(true);
    expect(result.ran).toBe(false);
    expect(result.note).toMatch(/Nothing was done/);
    expect(await db.note.count({ where: { leadId: lead.id } })).toBe(0);

    // The approval is still auditable — a person did decide.
    const audit = await db.auditLog.findFirst({
      where: { workspaceId: workspace.id, action: "agent_action.approved" },
    });
    expect(audit).not.toBeNull();
  });

  it("refuses to approve an unbuilt tool before running anything", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const agent = await makeAgent(workspace.id, ["send_email"]);
    const run = await db.agentRun.create({
      data: { workspaceId: workspace.id, agentId: agent.id, trigger: "manual", state: "SUCCEEDED" },
    });
    const action = await db.agentAction.create({
      data: {
        workspaceId: workspace.id,
        runId: run.id,
        sequence: 1,
        riskClass: "EXTERNAL",
        tool: "send_email",
        summary: "Send an email",
        state: "pending_approval",
        requiresApproval: true,
      },
    });

    await expect(approveAndRun(ctx, action.id)).rejects.toThrow(/declared but not built yet/);
    // Left pending, not half-approved.
    const after = await db.agentAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(after.state).toBe("pending_approval");
  });
});

describe("review-first is not a deadlock", () => {
  /** The workspace mode that holds everything — the default, and the seeded state. */
  async function reviewWorkspace() {
    withAi();
    const w = await freshWorkspace();
    await updateAutopilotConfig(w.ctx, {
      ...BASE,
      mode: "REVIEW_FIRST",
      requireApprovalForSpend: true,
    });
    return w;
  }

  it("approving in review-first actually runs the action", async () => {
    const { ctx, workspace } = await reviewWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["add_note"]);

    const held = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Written after approval.", leadId: lead.id },
    });
    expect(held.disposition).toBe("approve");

    // Before the fix this held a second time, and approving that held a third.
    const result = await approveAndRun(ctx, held.actionId);
    expect(result.ran).toBe(true);

    const note = await db.note.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(note.body).toBe("Written after approval.");
  });

  it("approving a spend in review-first spends it once", async () => {
    const { ctx, workspace } = await reviewWorkspace();
    await grantPoints(workspace.id, 50);
    const { lead, person } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.contactMethod.create({
      data: {
        workspaceId: workspace.id,
        personId: person.id,
        kind: "WORK_EMAIL",
        value: "priya@vaitarna.example",
        maskedValue: "p•••@vaitarna.example",
        isLocked: true,
        status: "VERIFIED",
        confidence: 92,
        source: "test",
      },
    });
    const agent = await makeAgent(workspace.id, ["unlock_contacts"]);

    const held = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "unlock_contacts",
      input: { leadId: lead.id },
    });
    expect(held.disposition).toBe("approve");

    const result = await approveAndRun(ctx, held.actionId);
    expect(result.ran).toBe(true);

    const contact = await db.contactMethod.findFirstOrThrow({
      where: { workspaceId: workspace.id },
    });
    expect(contact.isLocked).toBe(false);
    // Charged exactly once.
    expect(
      await db.pointLedger.count({ where: { workspaceId: workspace.id, type: "REVEAL" } })
    ).toBe(1);
  });

  it("approval does not exempt a suppressed lead", async () => {
    const { ctx, workspace } = await reviewWorkspace();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["add_note"]);

    const held = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Should not be written.", leadId: lead.id },
    });

    // They ask not to be contacted between the hold and the approval.
    await db.suppression.create({
      data: {
        workspaceId: workspace.id,
        kind: "domain",
        value: company.domain!.toLowerCase(),
        reason: "Asked to be removed",
        source: "reply",
      },
    });

    const result = await approveAndRun(ctx, held.actionId);
    expect(result.ran).toBe(false);
    expect(result.note).toMatch(/do-not-contact/);
    expect(await db.note.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("approval does not exempt an exhausted budget", async () => {
    const { ctx, workspace } = await reviewWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, ["add_note"], { cap: 1 });

    const held = await runToolAsAgent(ctx, {
      agentId: agent.id,
      tool: "add_note",
      input: { body: "Held.", leadId: lead.id },
    });
    // Something else uses the last action in the window.
    await db.agentAction.create({
      data: {
        workspaceId: workspace.id,
        runId: held.runId,
        sequence: 99,
        riskClass: "WRITE",
        tool: "add_note",
        summary: "Something else",
        state: "completed",
      },
    });

    const result = await approveAndRun(ctx, held.actionId);
    expect(result.ran).toBe(false);
    expect(result.note).toMatch(/actions for today/);
  });
});
