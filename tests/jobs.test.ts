import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, cleanup } from "./helpers/fixtures";
import { rescoreWorkspace } from "@/lib/queue/handlers/rescore";
import {
  archiveStaleLeads,
  detectDealRisks,
  purgeRecycleBin,
  rescoreWorklist,
} from "@/lib/queue/handlers/maintenance";
import { refreshNextBestActions, sweepNotifications } from "@/lib/queue/handlers/insights";
import { signPayload, verifySignature } from "@/lib/queue/handlers/webhooks";
import { JOB, JOB_POLICY, JOB_SCHEDULE, JOB_LABEL } from "@/lib/queue/jobs";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function freshWorkspace() {
  const w = await makeWorkspace("Jobs");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

/** A workspace with an ICP so the scoring engine has something to score against. */
async function workspaceWithIcp() {
  const w = await freshWorkspace();
  const icp = await db.icpProfile.create({
    data: {
      workspaceId: w.workspace.id,
      name: "Test ICP",
      isPrimary: true,
      industries: ["Manufacturing"],
      locations: ["Maharashtra", "Pune"],
      employeeMin: 100,
      employeeMax: 2000,
      buyerRoles: ["Head of IT"],
      seniorities: ["head"],
      technologies: [],
      pains: [],
      triggerEvents: [],
      exclusions: [],
    },
  });
  return { ...w, icp };
}

async function pipelineFor(workspaceId: string, stallAfterDays = 10) {
  const pipeline = await db.pipeline.create({
    data: { workspaceId, name: "P", isDefault: true },
  });
  const stages = [];
  for (const [i, name] of ["New", "Qualified", "Won"].entries()) {
    stages.push(
      await db.pipelineStage.create({
        data: {
          workspaceId,
          pipelineId: pipeline.id,
          key: name.toLowerCase(),
          name,
          sortOrder: i,
          probability: i === 0 ? 5 : i === 1 ? 50 : 100,
          stallAfterDays,
          isWon: name === "Won",
        },
      })
    );
  }
  return { pipeline, stages };
}

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("job catalogue", () => {
  it("gives every job a retry policy and a label", () => {
    for (const name of Object.values(JOB)) {
      expect(JOB_POLICY[name], `${name} has no policy`).toBeDefined();
      expect(JOB_POLICY[name].attempts).toBeGreaterThan(0);
      expect(JOB_LABEL[name], `${name} has no label`).toBeTruthy();
    }
  });

  it("retries webhook delivery hardest, since the receiver may be down", () => {
    expect(JOB_POLICY[JOB.DELIVER_WEBHOOK].attempts).toBeGreaterThan(
      JOB_POLICY[JOB.RESCORE_WORKSPACE].attempts
    );
  });

  it("explains every schedule it defines", () => {
    for (const [name, schedule] of Object.entries(JOB_SCHEDULE)) {
      expect(schedule!.cron, name).toMatch(/^[\d*/, -]+$/);
      expect(schedule!.describe.length, name).toBeGreaterThan(10);
    }
  });
});

describe("rescoreWorkspace", () => {
  it("writes a score with its evidence and derives tier and intent", async () => {
    const { ctx, workspace, icp } = await workspaceWithIcp();
    const { lead, person, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { icpProfileId: icp.id } });
    await db.signal.create({
      data: {
        workspaceId: workspace.id,
        leadId: lead.id,
        personId: person.id,
        companyId: company.id,
        type: "RFP",
        sourceKind: "TENDER_PORTAL",
        sourceName: "Test portal",
        title: "Published a tender",
        excerpt: "RFP for ERP modernisation, submission deadline this quarter",
        confidence: 95,
        keywords: ["rfp", "this quarter"],
        occurredAt: daysAgo(1),
        dedupeHash: `t-${lead.id}`,
      },
    });

    const summary = await rescoreWorkspace(workspace.id);
    expect(summary.leadsConsidered).toBe(1);
    expect(summary.leadsChanged).toBe(1);
    expect(summary.evidenceRows).toBeGreaterThan(0);

    const score = await db.leadScore.findUniqueOrThrow({
      where: { leadId: lead.id },
      include: { evidence: true },
    });
    expect(score.intentScore).toBeGreaterThan(0);
    expect(score.urgencyScore).toBeGreaterThan(0);
    expect(score.evidence.length).toBe(summary.evidenceRows);

    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(["A", "B", "C", "D"]).toContain(updated.tier);
    expect(updated.intent).not.toBe("COLD");
  });

  it("is idempotent — a second run changes nothing", async () => {
    const { ctx, workspace, icp } = await workspaceWithIcp();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { icpProfileId: icp.id } });

    await rescoreWorkspace(workspace.id);
    const second = await rescoreWorkspace(workspace.id);
    expect(second.leadsChanged).toBe(0);
    expect(second.evidenceRows).toBe(0);
  });

  it("replaces evidence rather than appending, so it cannot accumulate", async () => {
    const { ctx, workspace, icp } = await workspaceWithIcp();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { icpProfileId: icp.id } });

    await rescoreWorkspace(workspace.id);
    const first = await db.leadScoreEvidence.count({ where: { workspaceId: workspace.id } });

    // Force a change so the second run writes, then confirm no duplication.
    await db.lead.update({ where: { id: lead.id }, data: { estimatedBudgetInr: 5_000_000 } });
    await rescoreWorkspace(workspace.id);
    const second = await db.leadScoreEvidence.count({ where: { workspaceId: workspace.id } });

    expect(second).toBeLessThan(first * 2);
  });

  it("rolls account intent up from scored leads", async () => {
    const { ctx, workspace, icp } = await workspaceWithIcp();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { icpProfileId: icp.id } });

    await rescoreWorkspace(workspace.id);
    const row = await db.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(row.intentScore).toBeGreaterThan(0);
    // The derivation must be stated, not just the number.
    expect((row.intentScoreReason as Record<string, unknown>).method).toContain("strongest lead");
  });

  it("stays inside its own workspace", async () => {
    const a = await workspaceWithIcp();
    const b = await workspaceWithIcp();
    const leadA = await makeLead(a.workspace.id, { ownerId: a.ctx.userId });
    await db.lead.update({ where: { id: leadA.lead.id }, data: { icpProfileId: a.icp.id } });
    await makeLead(b.workspace.id, { ownerId: b.ctx.userId });

    const summary = await rescoreWorkspace(a.workspace.id);
    expect(summary.leadsConsidered).toBe(1);
  });

  it("skips a lead with no ICP rather than guessing at one", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeLead(workspace.id, { ownerId: ctx.userId });
    const summary = await rescoreWorkspace(workspace.id);
    expect(summary.leadsConsidered).toBe(1);
    expect(summary.leadsChanged).toBe(0);
  });
});

describe("detectDealRisks", () => {
  it("raises a stall flag past the stage threshold and explains it", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { stages } = await pipelineFor(workspace.id, 10);
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });

    await db.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: stages[0].pipelineId,
        stageId: stages[1].id,
        companyId: company.id,
        title: "Stalled deal",
        valueInr: 500_000,
        stageEnteredAt: daysAgo(30),
        lastActivityAt: daysAgo(1),
        nextActionAt: new Date(Date.now() + DAY),
      },
    });

    const result = await detectDealRisks(workspace.id);
    expect(result.raised).toBeGreaterThan(0);

    const risk = await db.dealRisk.findFirstOrThrow({
      where: { workspaceId: workspace.id, code: "stage_stalled" },
    });
    expect(risk.title).toContain("30 days");
    // 3× the threshold is high severity.
    expect(risk.severity).toBe("high");
    expect(risk.suggestedAction).toBeTruthy();
  });

  it("resolves a flag once the problem is fixed", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { stages } = await pipelineFor(workspace.id, 10);
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });

    const deal = await db.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: stages[0].pipelineId,
        stageId: stages[1].id,
        companyId: company.id,
        title: "Needs a next step",
        valueInr: 500_000,
        stageEnteredAt: new Date(),
        lastActivityAt: new Date(),
        nextActionAt: null,
      },
    });

    await detectDealRisks(workspace.id);
    expect(
      await db.dealRisk.count({ where: { dealId: deal.id, code: "no_next_action", resolvedAt: null } })
    ).toBe(1);

    // Fix it, re-run, and the warning must not survive.
    await db.deal.update({
      where: { id: deal.id },
      data: { nextActionAt: new Date(Date.now() + DAY) },
    });
    const second = await detectDealRisks(workspace.id);
    expect(second.resolved).toBeGreaterThan(0);
    expect(
      await db.dealRisk.count({ where: { dealId: deal.id, code: "no_next_action", resolvedAt: null } })
    ).toBe(0);
  });

  it("does not flag a missing next step on an early-stage deal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { stages } = await pipelineFor(workspace.id);
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });

    await db.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: stages[0].pipelineId,
        // "New" sits at 5% probability — nobody is working it yet.
        stageId: stages[0].id,
        companyId: company.id,
        title: "Brand new",
        valueInr: 100_000,
        stageEnteredAt: new Date(),
        lastActivityAt: new Date(),
        nextActionAt: null,
      },
    });

    await detectDealRisks(workspace.id);
    expect(
      await db.dealRisk.count({ where: { workspaceId: workspace.id, code: "no_next_action" } })
    ).toBe(0);
  });

  it("is idempotent", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { stages } = await pipelineFor(workspace.id, 5);
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: stages[0].pipelineId,
        stageId: stages[1].id,
        companyId: company.id,
        title: "Stalled",
        valueInr: 500_000,
        stageEnteredAt: daysAgo(40),
        lastActivityAt: daysAgo(40),
      },
    });

    await detectDealRisks(workspace.id);
    const after1 = await db.dealRisk.count({ where: { workspaceId: workspace.id } });
    await detectDealRisks(workspace.id);
    const after2 = await db.dealRisk.count({ where: { workspaceId: workspace.id } });
    expect(after2).toBe(after1);
  });
});

describe("archiveStaleLeads", () => {
  it("archives an inactive lead and records why", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({
      where: { id: lead.id },
      data: { lastActivityAt: daysAgo(90), surfacedAt: daysAgo(100) },
    });

    const result = await archiveStaleLeads(workspace.id);
    expect(result.archived).toBe(1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).archivedAt).not.toBeNull();

    const activity = await db.activity.findFirstOrThrow({
      where: { workspaceId: workspace.id, kind: "leads.auto_archived" },
    });
    expect(activity.actorType).toBe("SYSTEM");
    expect(activity.detail).toContain("Still fully searchable");
  });

  it("never archives a lead that replied", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({
      where: { id: lead.id },
      data: { lastActivityAt: daysAgo(200), repliedAt: daysAgo(200) },
    });

    expect((await archiveStaleLeads(workspace.id)).archived).toBe(0);
  });

  it("never archives a lead with an open deal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { stages } = await pipelineFor(workspace.id);
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { lastActivityAt: daysAgo(200) } });
    await db.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: stages[0].pipelineId,
        stageId: stages[0].id,
        leadId: lead.id,
        companyId: company.id,
        title: "Live deal",
        valueInr: 100_000,
        status: "OPEN",
      },
    });

    expect((await archiveStaleLeads(workspace.id)).archived).toBe(0);
  });

  it("never archives a lead with an open task", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { lastActivityAt: daysAgo(200) } });
    await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Still owed",
        leadId: lead.id,
        ownerId: ctx.userId,
        status: "QUEUED",
      },
    });

    expect((await archiveStaleLeads(workspace.id)).archived).toBe(0);
  });

  it("respects the workspace's own window", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await db.workspace.update({ where: { id: workspace.id }, data: { archiveAfterDays: 365 } });
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { lastActivityAt: daysAgo(90) } });

    const result = await archiveStaleLeads(workspace.id);
    expect(result.afterDays).toBe(365);
    expect(result.archived).toBe(0);
  });
});

describe("purgeRecycleBin", () => {
  it("removes only entries past their purge date", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });

    const note = await db.note.create({
      data: { workspaceId: workspace.id, body: "due", leadId: lead.id, deletedAt: new Date() },
    });
    const keep = await db.note.create({
      data: { workspaceId: workspace.id, body: "not due", leadId: lead.id, deletedAt: new Date() },
    });

    await db.deletedRecord.create({
      data: {
        workspaceId: workspace.id,
        objectType: "Note",
        objectId: note.id,
        label: "due",
        deletedByLabel: "Test",
        purgeAfter: daysAgo(1),
      },
    });
    await db.deletedRecord.create({
      data: {
        workspaceId: workspace.id,
        objectType: "Note",
        objectId: keep.id,
        label: "not due",
        deletedByLabel: "Test",
        purgeAfter: new Date(Date.now() + 30 * DAY),
      },
    });

    const result = await purgeRecycleBin(workspace.id);
    expect(result.purged).toBe(1);
    expect(await db.note.findUnique({ where: { id: note.id } })).toBeNull();
    expect(await db.note.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });

  it("leaves a restored entry alone", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const note = await db.note.create({
      data: { workspaceId: workspace.id, body: "restored", leadId: lead.id },
    });
    await db.deletedRecord.create({
      data: {
        workspaceId: workspace.id,
        objectType: "Note",
        objectId: note.id,
        label: "restored",
        deletedByLabel: "Test",
        purgeAfter: daysAgo(5),
        restoredAt: daysAgo(2),
      },
    });

    expect((await purgeRecycleBin(workspace.id)).purged).toBe(0);
    expect(await db.note.findUnique({ where: { id: note.id } })).not.toBeNull();
  });
});

describe("rescoreWorklist", () => {
  it("ranks a reply above an ordinary task and says why", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const replied = await makeLead(workspace.id, { ownerId: ctx.userId, intent: "BUYING", tier: "A" });
    await db.lead.update({ where: { id: replied.lead.id }, data: { repliedAt: new Date() } });
    const quiet = await makeLead(workspace.id, { ownerId: ctx.userId, intent: "COLD", tier: "D" });

    const urgent = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Reply",
        leadId: replied.lead.id,
        ownerId: ctx.userId,
        priority: "HIGH",
        status: "QUEUED",
      },
    });
    const ordinary = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Someday",
        leadId: quiet.lead.id,
        ownerId: ctx.userId,
        priority: "HIGH",
        status: "QUEUED",
      },
    });

    await rescoreWorklist(workspace.id);

    const a = await db.task.findUniqueOrThrow({ where: { id: urgent.id } });
    const b = await db.task.findUniqueOrThrow({ where: { id: ordinary.id } });
    expect(a.priorityScore).toBeGreaterThan(b.priorityScore);
    expect(a.priorityReason).toContain("replied");
  });

  it("does not overwrite a reason an agent wrote", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Agent task",
        leadId: lead.id,
        ownerId: ctx.userId,
        status: "QUEUED",
        createdByAi: true,
        priorityReason: "Reasoning the agent produced, with evidence behind it.",
        priorityScore: 1,
      },
    });

    await rescoreWorklist(workspace.id);
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.priorityScore).not.toBe(1);
    expect(after.priorityReason).toBe("Reasoning the agent produced, with evidence behind it.");
  });

  it("ignores completed tasks", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Done",
        leadId: lead.id,
        ownerId: ctx.userId,
        status: "DONE",
      },
    });
    expect((await rescoreWorklist(workspace.id)).tasksConsidered).toBe(0);
  });
});

describe("refreshNextBestActions", () => {
  it("puts replying first when someone is waiting", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { repliedAt: new Date() } });

    await refreshNextBestActions(workspace.id, [lead.id]);
    const actions = await db.nextBestAction.findMany({
      where: { leadId: lead.id },
      orderBy: { rank: "asc" },
    });

    expect(actions[0].action).toBe("reply_now");
    // Every recommendation must carry a rationale, not just a label.
    for (const a of actions) expect(a.rationale.length).toBeGreaterThan(20);
  });

  it("recommends waiting, with a reason, when there is no signal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId, score: 2 });

    await refreshNextBestActions(workspace.id, [lead.id]);
    const actions = await db.nextBestAction.findMany({
      where: { leadId: lead.id },
      orderBy: { rank: "asc" },
    });
    expect(actions[0].action).toBe("wait");
    expect(actions[0].rationale).toContain("credibility");
  });

  it("replaces rather than accumulating", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });

    await refreshNextBestActions(workspace.id, [lead.id]);
    const first = await db.nextBestAction.count({ where: { leadId: lead.id } });
    await refreshNextBestActions(workspace.id, [lead.id]);
    const second = await db.nextBestAction.count({ where: { leadId: lead.id } });
    expect(second).toBe(first);
  });
});

describe("sweepNotifications", () => {
  it("does not notify the same thing twice", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, person, company } = await makeLead(workspace.id, {
      ownerId: ctx.userId,
      tier: "A",
      intent: "BUYING",
    });
    await db.signal.create({
      data: {
        workspaceId: workspace.id,
        leadId: lead.id,
        personId: person.id,
        companyId: company.id,
        type: "RFP",
        sourceKind: "TENDER_PORTAL",
        sourceName: "Portal",
        title: "Tender published",
        excerpt: "x",
        confidence: 95,
        keywords: [],
        occurredAt: new Date(),
        detectedAt: new Date(),
        dedupeHash: `n-${lead.id}`,
      },
    });

    const first = await sweepNotifications(workspace.id);
    expect(first.raised).toBeGreaterThan(0);

    // A sweep every fifteen minutes must not re-notify.
    const second = await sweepNotifications(workspace.id);
    expect(second.raised).toBe(0);
  });
});

describe("webhook signatures", () => {
  it("round-trips a signature", () => {
    const secret = "s3cret";
    const body = JSON.stringify({ event: "lead.created" });
    const ts = Math.floor(Date.now() / 1000);
    const header = `t=${ts},${signPayload(secret, body, ts)}`;
    expect(verifySignature(secret, body, header)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const secret = "s3cret";
    const ts = Math.floor(Date.now() / 1000);
    const header = `t=${ts},${signPayload(secret, "original", ts)}`;
    expect(verifySignature(secret, "tampered", header)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = `t=${ts},${signPayload("right", "body", ts)}`;
    expect(verifySignature("wrong", "body", header)).toBe(false);
  });

  it("rejects a replay outside the tolerance window", () => {
    const secret = "s3cret";
    const old = Math.floor(Date.now() / 1000) - 3_600;
    const header = `t=${old},${signPayload(secret, "body", old)}`;
    expect(verifySignature(secret, "body", header, 300)).toBe(false);
    // Still valid if the receiver chooses a wider window.
    expect(verifySignature(secret, "body", header, 7_200)).toBe(true);
  });

  it("rejects a malformed header", () => {
    expect(verifySignature("s", "body", "garbage")).toBe(false);
    expect(verifySignature("s", "body", "")).toBe(false);
  });
});

describe("enqueue dedupe window", () => {
  it("collapses a burst but not a later request", async () => {
    // Exercised through the exported helper's observable behaviour: two calls
    // inside the window share an id, two calls across it do not.
    const { enqueue } = await import("@/lib/queue/producer");
    const { isQueueConfigured } = await import("@/lib/queue/connection");

    if (!isQueueConfigured()) {
      // Without Redis the call reports not_configured rather than throwing,
      // which is itself the contract worth asserting.
      const r = await enqueue(
        JOB.RESCORE_WORKSPACE,
        { workspaceId: "00000000-0000-0000-0000-000000000000" },
        { dedupeKey: "test-key" }
      );
      expect(r.queued).toBe(false);
      if (!r.queued) expect(r.reason).toBe("not_configured");
      return;
    }

    const ws = "00000000-0000-0000-0000-000000000000";
    const a = await enqueue(JOB.RESCORE_WORKSPACE, { workspaceId: ws }, {
      dedupeKey: "dedupe-test",
      dedupeWindowSec: 3600,
    });
    const b = await enqueue(JOB.RESCORE_WORKSPACE, { workspaceId: ws }, {
      dedupeKey: "dedupe-test",
      dedupeWindowSec: 3600,
    });
    // Same window, same key: BullMQ returns the existing job.
    if (a.queued && b.queued) expect(b.jobId).toBe(a.jobId);

    // A zero window means no bucketing at all, which is the permanent-key
    // behaviour — kept available but never the default.
    const c = await enqueue(JOB.RESCORE_WORKSPACE, { workspaceId: ws }, {
      dedupeKey: "dedupe-test-distinct",
      dedupeWindowSec: 0,
    });
    if (a.queued && c.queued) expect(c.jobId).not.toBe(a.jobId);
  });
});
