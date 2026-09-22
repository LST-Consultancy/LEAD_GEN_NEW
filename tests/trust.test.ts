import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import {
  listApprovals,
  summariseApprovals,
  getTrustSummary,
  getAgentDetail,
} from "@/lib/services/trust";
import { updateAutopilotConfig } from "@/lib/services/autopilot";
import { approveAllPending } from "@/lib/services/agent-runner";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Trust");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

function withoutProviders() {
  for (const k of [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "EMAIL_PROVIDER",
    "SMTP_URL",
    "RESEND_API_KEY",
    "GOOGLE_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_ID",
    "CALDAV_URL",
  ]) {
    vi.stubEnv(k, "");
  }
}

function withAi() {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
}

async function makeAgent(
  workspaceId: string,
  over: { tools?: string[]; isEnabled?: boolean; policy?: string; kind?: string } = {}
) {
  return db.aIAgent.create({
    data: {
      workspaceId,
      kind: (over.kind ?? "RESEARCH") as never,
      name: "Research agent",
      goal: "Build dossiers.",
      isEnabled: over.isEnabled ?? true,
      tools: over.tools ?? ["get_today", "add_note"],
      approvalPolicy: over.policy ?? "auto_within_budget",
      dailyPointBudget: 10,
      dailyActionCap: 20,
    },
  });
}

async function heldAction(
  workspaceId: string,
  agentId: string,
  over: { tool?: string; risk?: string; points?: number; leadId?: string } = {}
) {
  const run = await db.agentRun.create({
    data: { workspaceId, agentId, trigger: "schedule:daily", state: "SUCCEEDED" },
  });
  return db.agentAction.create({
    data: {
      workspaceId,
      runId: run.id,
      sequence: 1,
      riskClass: over.risk ?? "SPEND",
      tool: over.tool ?? "unlock_contacts",
      summary: "Unlock two verified contacts",
      state: "pending_approval",
      requiresApproval: true,
      pointsSpent: over.points ?? 2,
      leadId: over.leadId,
    },
  });
}

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("the unified approval queue", () => {
  it("brings agent actions and drafted messages into one list", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id);
    await heldAction(workspace.id, agent.id, { leadId: lead.id });

    const conversation = await db.conversation.create({
      data: { workspaceId: workspace.id, channel: "EMAIL", leadId: lead.id, companyId: company.id },
    });
    await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        state: "PENDING_APPROVAL",
        subject: "Quick question",
        body: "Worth a short call?",
        generatedByAi: true,
        aiModel: "claude-haiku-4-5",
      },
    });

    const pending = await listApprovals(ctx);
    expect(pending.map((p) => p.kind).sort()).toEqual(["agent_action", "message"]);
    // Both carry the lead they concern, so a reviewer sees who it touches.
    expect(pending.every((p) => p.leadName !== null)).toBe(true);
  });

  it("is ordered oldest first, because that is the order to work it", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id);
    const older = await heldAction(workspace.id, agent.id, { tool: "add_note", risk: "WRITE" });
    await db.agentAction.update({
      where: { id: older.id },
      data: { occurredAt: new Date(Date.now() - 86_400_000) },
    });
    await heldAction(workspace.id, agent.id);

    const pending = await listApprovals(ctx);
    expect(pending[0].id).toBe(older.id);
  });

  it("says which items could not take effect, and why", async () => {
    withoutProviders();
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id);
    // Built tool → executable. Unbuilt tool → not.
    await heldAction(workspace.id, agent.id, { tool: "add_note", risk: "WRITE", points: 0 });
    await heldAction(workspace.id, agent.id, { tool: "send_whatsapp", risk: "EXTERNAL", points: 0 });

    const conversation = await db.conversation.create({
      data: { workspaceId: workspace.id, channel: "EMAIL", leadId: lead.id, companyId: company.id },
    });
    await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        state: "PENDING_APPROVAL",
        subject: "Hello",
        body: "Body",
      },
    });

    const pending = await listApprovals(ctx);
    const note = pending.find((p) => p.title.includes("Unlock") && p.detail?.includes("add_note"));
    const whatsapp = pending.find((p) => p.detail?.includes("send_whatsapp"));
    const message = pending.find((p) => p.kind === "message");

    expect(note?.executable).toBe(true);
    expect(whatsapp?.executable).toBe(false);
    expect(whatsapp?.blockedBecause).toMatch(/declared but not built/);
    // No mailbox, so an outbound message cannot take effect either.
    expect(message?.executable).toBe(false);
    expect(message?.blockedBecause).toMatch(/cannot drain/);
  });

  it("hides an item about a lead the reviewer cannot see", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id);
    await heldAction(workspace.id, agent.id, { leadId: lead.id });
    const rep = await addMember(workspace.id, "Rep", "sales_rep");

    expect(await listApprovals(ctx)).toHaveLength(1);
    expect(await listApprovals(rep)).toHaveLength(0);
  });

  it("keeps an item with no lead visible to everyone", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id);
    await heldAction(workspace.id, agent.id);
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    expect(await listApprovals(rep)).toHaveLength(1);
    void ctx;
  });

  it("does not cross workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const agent = await makeAgent(b.workspace.id);
    await heldAction(b.workspace.id, agent.id);
    expect(await listApprovals(a.ctx)).toHaveLength(0);
    expect(await listApprovals(b.ctx)).toHaveLength(1);
  });
});

describe("summariseApprovals", () => {
  const item = (over: Partial<Awaited<ReturnType<typeof listApprovals>>[number]> = {}) => ({
    id: "x",
    kind: "agent_action" as const,
    riskClass: "SPEND",
    title: "t",
    detail: null,
    pointsCost: 2,
    executable: true,
    blockedBecause: null,
    actor: "a",
    leadId: null,
    leadName: null,
    companyName: "Vaitarna Steel Works",
    occurredAt: new Date().toISOString(),
    ...over,
  });

  it("says exactly how many will run and how many cannot", () => {
    const s = summariseApprovals([
      item(),
      item({ executable: false, blockedBecause: "not built" }),
    ]);
    expect(s).toMatchObject({ total: 2, willRun: 1, cannotRun: 1 });
  });

  it("counts points only for what will actually run", () => {
    const s = summariseApprovals([
      item({ pointsCost: 5 }),
      item({ pointsCost: 100, executable: false, blockedBecause: "not built" }),
    ]);
    expect(s.pointsAtStake).toBe(5);
  });

  it("names the companies about to be touched", () => {
    const s = summariseApprovals([item(), item({ companyName: "Kaveri Logistics" })]);
    expect(s.companies.sort()).toEqual(["Kaveri Logistics", "Vaitarna Steel Works"]);
  });

  it("groups what will run by risk class", () => {
    const s = summariseApprovals([item({ riskClass: "SPEND" }), item({ riskClass: "EXTERNAL" })]);
    expect(s.byRisk).toEqual({ SPEND: 1, EXTERNAL: 1 });
  });

  it("deduplicates the blocking reasons", () => {
    const s = summariseApprovals([
      item({ executable: false, blockedBecause: "same reason" }),
      item({ executable: false, blockedBecause: "same reason" }),
    ]);
    expect(s.blockedReasons).toEqual(["same reason"]);
  });

  it("is all zeroes for an empty queue", () => {
    expect(summariseApprovals([])).toMatchObject({
      total: 0,
      willRun: 0,
      cannotRun: 0,
      pointsAtStake: 0,
    });
  });
});

describe("the trust summary", () => {
  it("reports every service as unconnected when nothing is", async () => {
    withoutProviders();
    const { ctx } = await freshWorkspace();
    const trust = await getTrustSummary(ctx);
    expect(trust.services.every((s) => !s.connected)).toBe(true);
    // And each one says what it would be allowed to do if connected.
    expect(trust.services.every((s) => s.grants.length > 10)).toBe(true);
  });

  it("separates tools granted from tools actually reachable", async () => {
    withAi();
    const { ctx, workspace } = await freshWorkspace();
    // Two granted, one built.
    await makeAgent(workspace.id, { tools: ["add_note", "send_whatsapp"] });

    const trust = await getTrustSummary(ctx);
    expect(trust.reach.toolsGranted).toBe(2);
    expect(trust.reach.toolsReachable).toBe(1);
    expect(trust.reach.reachableNames).toEqual(["add_note"]);
  });

  it("counts only enabled agents' grants", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeAgent(workspace.id, { tools: ["add_note"], isEnabled: false });
    const trust = await getTrustSummary(ctx);
    expect(trust.reach.toolsGranted).toBe(0);
    expect(trust.reach.agentsEnabled).toBe(0);
    expect(trust.reach.agentsTotal).toBe(1);
  });

  it("names the agents that always ask, whatever the mode", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeAgent(workspace.id, { policy: "review_first" });
    const trust = await getTrustSummary(ctx);
    expect(trust.reach.alwaysAsks).toEqual(["Research agent"]);
  });

  it("restates the policy from the enforced settings", async () => {
    withAi();
    const { ctx } = await freshWorkspace();
    await updateAutopilotConfig(ctx, {
      mode: "REVIEW_FIRST",
      maxLeadsPerDay: 20,
      maxRevealsPerDay: 5,
      maxPointsPerDay: 25,
      maxEmailsPerDay: 30,
      maxWhatsappPerDay: 10,
      maxLinkedinPerDay: 10,
      allowedTiers: ["A"],
      minScore: 80,
      allowedChannels: ["EMAIL"],
      sendWindowStart: 9,
      sendWindowEnd: 19,
      sendDays: [1, 2, 3],
      approvalThresholdInr: 0,
      requireApprovalForSpend: true,
    });

    const trust = await getTrustSummary(ctx);
    expect(trust.mode).toBe("REVIEW_FIRST");
    expect(trust.policy.join(" ")).toMatch(/tier A leads scoring 80 or above/);
    expect(trust.limits.requireApprovalForSpend).toBe(true);
  });

  it("reports the reviewer's own role and whether they may approve", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const viewer = await addMember(workspace.id, "Viewer", "viewer");

    const owner = await getTrustSummary(ctx);
    expect(owner.you.canApprove).toBe(true);
    expect(owner.you.canConfigure).toBe(true);

    const limited = await getTrustSummary(viewer);
    expect(limited.you.canApprove).toBe(false);
    expect(limited.you.role).toBe("Viewer");
    expect(limited.you.permissionCount).toBeLessThan(limited.you.ofPossible);
  });

  it("lists which roles could approve, so the gap is visible", async () => {
    const { ctx } = await freshWorkspace();
    const trust = await getTrustSummary(ctx);
    const approvers = trust.roleCatalogue.filter((r) => r.canApprove).map((r) => r.key);
    expect(approvers).toContain("owner");
    expect(approvers).toContain("manager");
    expect(approvers).not.toContain("viewer");
  });

  it("shows recent actions with whether each could take effect", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id);
    const run = await db.agentRun.create({
      data: { workspaceId: workspace.id, agentId: agent.id, trigger: "manual", state: "SUCCEEDED" },
    });
    await db.agentAction.createMany({
      data: [
        {
          workspaceId: workspace.id,
          runId: run.id,
          sequence: 1,
          riskClass: "WRITE",
          tool: "add_note",
          summary: "Wrote a note",
          state: "completed",
        },
        {
          workspaceId: workspace.id,
          runId: run.id,
          sequence: 2,
          riskClass: "EXTERNAL",
          tool: "send_email",
          summary: "Would send",
          state: "refused",
        },
      ],
    });

    const trust = await getTrustSummary(ctx);
    expect(trust.recent).toHaveLength(2);
    expect(trust.recent.find((r) => r.tool === "add_note")?.executable).toBe(true);
    expect(trust.recent.find((r) => r.tool === "send_email")?.executable).toBe(false);
  });

  it("does not leak another workspace's actions", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const agent = await makeAgent(b.workspace.id);
    const run = await db.agentRun.create({
      data: { workspaceId: b.workspace.id, agentId: agent.id, trigger: "m", state: "SUCCEEDED" },
    });
    await db.agentAction.create({
      data: {
        workspaceId: b.workspace.id,
        runId: run.id,
        sequence: 1,
        riskClass: "WRITE",
        tool: "add_note",
        summary: "Theirs",
        state: "completed",
      },
    });

    expect((await getTrustSummary(a.ctx)).recent).toHaveLength(0);
    expect((await getTrustSummary(b.ctx)).recent).toHaveLength(1);
  });
});

describe("agent detail", () => {
  it("returns the agent with its tools and run history", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const agent = await makeAgent(workspace.id, { tools: ["add_note", "find_leads"] });
    const run = await db.agentRun.create({
      data: {
        workspaceId: workspace.id,
        agentId: agent.id,
        trigger: "manual",
        state: "SUCCEEDED",
        summary: "One pass.",
      },
    });
    await db.agentAction.create({
      data: {
        workspaceId: workspace.id,
        runId: run.id,
        sequence: 1,
        riskClass: "WRITE",
        tool: "add_note",
        summary: "Wrote a note",
        state: "completed",
      },
    });

    const detail = await getAgentDetail(ctx, agent.id);
    expect(detail?.tools.map((t) => t.name)).toEqual(["add_note", "find_leads"]);
    expect(detail?.tools.find((t) => t.name === "find_leads")?.known).toBe(false);
    expect(detail?.runs[0].actions[0].executable).toBe(true);
  });

  it("returns null across workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const agent = await makeAgent(b.workspace.id);
    expect(await getAgentDetail(a.ctx, agent.id)).toBeNull();
    expect(await getAgentDetail(b.ctx, agent.id)).not.toBeNull();
  });
});

describe("approving everything", () => {
  async function autoWorkspace() {
    withAi();
    const w = await freshWorkspace();
    await updateAutopilotConfig(w.ctx, {
      mode: "FULL_AUTO",
      maxLeadsPerDay: 20,
      maxRevealsPerDay: 5,
      maxPointsPerDay: 25,
      maxEmailsPerDay: 30,
      maxWhatsappPerDay: 10,
      maxLinkedinPerDay: 10,
      allowedTiers: ["A", "B", "C", "D"],
      minScore: 0,
      allowedChannels: ["EMAIL"],
      sendWindowStart: 0,
      sendWindowEnd: 24,
      sendDays: [1, 2, 3, 4, 5, 6, 7],
      approvalThresholdInr: 0,
      requireApprovalForSpend: false,
    });
    return w;
  }

  it("runs what can run and leaves the rest queued", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, { tools: ["add_note", "send_whatsapp"] });

    // One built, one not.
    const runnable = await heldAction(workspace.id, agent.id, {
      tool: "add_note",
      risk: "WRITE",
      points: 0,
      leadId: lead.id,
    });
    await db.agentAction.update({
      where: { id: runnable.id },
      data: { input: { body: "Bulk-approved note.", leadId: lead.id } },
    });
    const blocked = await heldAction(workspace.id, agent.id, {
      tool: "send_whatsapp",
      risk: "EXTERNAL",
      points: 0,
      leadId: lead.id,
    });

    const result = await approveAllPending(ctx);
    expect(result.ran).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/declared but not built/);

    // The unbuilt one is genuinely still queued, not silently approved.
    const after = await db.agentAction.findUniqueOrThrow({ where: { id: blocked.id } });
    expect(after.state).toBe("pending_approval");

    // And the runnable one actually wrote its note.
    const note = await db.note.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(note.body).toBe("Bulk-approved note.");
  });

  it("reports what happened rather than averaging it into a success", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const agent = await makeAgent(workspace.id, { tools: ["send_whatsapp"] });
    await heldAction(workspace.id, agent.id, { tool: "send_whatsapp", risk: "EXTERNAL", points: 0 });

    const result = await approveAllPending(ctx);
    expect(result.ran).toBe(0);
    expect(result.note).toMatch(/left queued because nothing would happen/);
  });

  it("says so plainly when nothing in the queue can run", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const agent = await makeAgent(workspace.id, { tools: ["send_email"] });
    await heldAction(workspace.id, agent.id, { tool: "send_email", risk: "EXTERNAL", points: 0 });
    void agent;

    const result = await approveAllPending(ctx, { ids: [] });
    expect(result.note).toBe("Nothing in the queue could run.");
  });

  it("can be limited to chosen items", async () => {
    const { ctx, workspace } = await autoWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const agent = await makeAgent(workspace.id, { tools: ["add_note"] });

    const first = await heldAction(workspace.id, agent.id, {
      tool: "add_note",
      risk: "WRITE",
      points: 0,
      leadId: lead.id,
    });
    await db.agentAction.update({
      where: { id: first.id },
      data: { input: { body: "Chosen.", leadId: lead.id } },
    });
    const second = await heldAction(workspace.id, agent.id, {
      tool: "add_note",
      risk: "WRITE",
      points: 0,
      leadId: lead.id,
    });
    await db.agentAction.update({
      where: { id: second.id },
      data: { input: { body: "Not chosen.", leadId: lead.id } },
    });

    await approveAllPending(ctx, { ids: [first.id] });
    const bodies = (
      await db.note.findMany({ where: { leadId: lead.id }, select: { body: true } })
    ).map((n) => n.body);
    expect(bodies).toEqual(["Chosen."]);
    expect(
      (await db.agentAction.findUniqueOrThrow({ where: { id: second.id } })).state
    ).toBe("pending_approval");
  });
});
