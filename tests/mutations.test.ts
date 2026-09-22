import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, makeWorkspace, makeLead, addMember, grantPoints, cleanup } from "./helpers/fixtures";
import {
  updateLead,
  archiveLead,
  restoreLead,
  discardLead,
  revealContacts,
  quoteReveal,
  overrideLeadScore,
} from "@/lib/services/lead-mutations";
import { createNote, updateNote, deleteNote } from "@/lib/services/notes";
import { createTask, updateTask, deleteTask } from "@/lib/services/tasks";
import { createDeal, updateDeal, deleteDeal } from "@/lib/services/deal-mutations";
import { MutationError } from "@/lib/services/mutate";
import { ForbiddenError } from "@/lib/auth/context";
import { InsufficientPointsError, getBalance } from "@/lib/services/points";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace(points = 100) {
  const w = await makeWorkspace("Mut");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  if (points > 0) await grantPoints(w.workspace.id, points);
  return w;
}

/** A lead whose person has one locked-with-value and one valueless method. */
async function leadWithContacts(workspaceId: string, ownerId: string) {
  const { lead, person } = await makeLead(workspaceId, { ownerId });
  await db.contactMethod.create({
    data: {
      workspaceId,
      personId: person.id,
      kind: "WORK_EMAIL",
      value: "priya@example.invalid",
      maskedValue: "pr•••@example.invalid",
      isLocked: true,
      isPrimary: true,
      status: "VERIFIED",
      source: "Licensed dataset",
    },
  });
  await db.contactMethod.create({
    data: {
      workspaceId,
      personId: person.id,
      kind: "MOBILE",
      // Known to exist, but the provider returned nothing.
      value: null,
      maskedValue: "+91 98•••••",
      isLocked: true,
      status: "UNVERIFIED",
      source: "Licensed dataset",
    },
  });
  return { lead, person };
}

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("lead updates", () => {
  it("applies a field change and records both logs", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id);

    const result = await updateLead(ctx, lead.id, { status: "QUALIFIED", tier: "A" });
    expect(result.status).toBe("QUALIFIED");
    expect(result.tier).toBe("A");

    const audit = await db.auditLog.findFirst({
      where: { workspaceId: workspace.id, objectId: lead.id, action: "lead.updated" },
    });
    expect(audit).not.toBeNull();
    expect((audit!.before as Record<string, unknown>).status).toBe("NEW");
    expect((audit!.after as Record<string, unknown>).status).toBe("QUALIFIED");

    const activity = await db.activity.findFirst({
      where: { workspaceId: workspace.id, leadId: lead.id, kind: "lead.updated" },
    });
    expect(activity?.summary).toContain("status new → qualified");
  });

  it("stamps repliedAt when the status becomes REPLIED", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id);
    await updateLead(ctx, lead.id, { status: "REPLIED" });
    const row = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.repliedAt).not.toBeNull();
  });

  it("keeps a star out of the team activity feed", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id);
    await updateLead(ctx, lead.id, { isStarred: true });

    // Audited, because everything is — but not surfaced as team activity.
    expect(
      await db.auditLog.count({ where: { objectId: lead.id, action: "lead.updated" } })
    ).toBe(1);
    expect(await db.activity.count({ where: { leadId: lead.id, kind: "lead.updated" } })).toBe(0);
  });

  it("refuses to reassign a lead without team-wide visibility", async () => {
    const { workspace } = await freshWorkspace();
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    const other = await addMember(workspace.id, "Other", "sales_rep");
    const { lead } = await makeLead(workspace.id, { ownerId: rep.userId });

    await expect(updateLead(rep, lead.id, { ownerId: other.userId })).rejects.toThrow(
      MutationError
    );
  });

  it("refuses an owner who is not a workspace member", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const outsider = await freshWorkspace();
    const { lead } = await makeLead(workspace.id);

    await expect(updateLead(ctx, lead.id, { ownerId: outsider.user.id })).rejects.toThrow(
      /doesn't exist, or you don't have access/
    );
  });

  it("refuses to touch a lead in another workspace", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const { lead } = await makeLead(b.workspace.id);

    await expect(updateLead(a.ctx, lead.id, { isStarred: true })).rejects.toThrow(
      /doesn't exist, or you don't have access/
    );
  });

  it("blocks a viewer from editing anything", async () => {
    const { workspace } = await freshWorkspace();
    const viewer = await addMember(workspace.id, "Viewer", "viewer");
    const { lead } = await makeLead(workspace.id, { ownerId: viewer.userId });

    await expect(updateLead(viewer, lead.id, { isStarred: true })).rejects.toThrow(ForbiddenError);
  });
});

describe("archive, restore, discard", () => {
  it("archives and restores without losing the row", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id);

    await archiveLead(ctx, lead.id);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).archivedAt).not.toBeNull();

    await restoreLead(ctx, lead.id);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).archivedAt).toBeNull();
  });

  it("refuses to archive twice", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id);
    await archiveLead(ctx, lead.id);
    await expect(archiveLead(ctx, lead.id)).rejects.toThrow(/already archived/);
  });

  it("requires a reason to discard, and indexes it for the recycle bin", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id);

    await discardLead(ctx, lead.id, "Wrong industry — they resell, they don't build");
    const row = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.discardedAt).not.toBeNull();
    expect(row.status).toBe("UNQUALIFIED");

    const bin = await db.deletedRecord.findFirst({
      where: { workspaceId: workspace.id, objectType: "Lead", objectId: lead.id },
    });
    expect(bin).not.toBeNull();
    expect(bin!.purgeAfter.getTime()).toBeGreaterThan(Date.now());
    expect(bin!.deletedByLabel).toBe(ctx.user.name);
  });
});

describe("contact reveal", () => {
  it("quotes only what it can actually charge for", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithContacts(workspace.id, ctx.userId);

    const quote = await quoteReveal(ctx, lead.id);
    // The valueless MOBILE is excluded from the price.
    expect(quote.cost).toBe(1);
    expect(quote.chargeable.map((c) => c.kind)).toEqual(["WORK_EMAIL"]);
  });

  it("charges once, unlocks the value, and reports what it skipped", async () => {
    const { ctx, workspace } = await freshWorkspace(10);
    const { lead } = await leadWithContacts(workspace.id, ctx.userId);

    const result = await revealContacts(ctx, lead.id, { idempotencyKey: randomUUID() });

    expect(result.pointsSpent).toBe(1);
    expect(result.balance).toBe(9);
    expect(result.revealed).toHaveLength(1);
    expect(result.revealed[0].value).toBe("priya@example.invalid");
    // The method with no value is reported, not silently ignored.
    expect(result.skipped).toEqual([
      expect.objectContaining({ kind: "MOBILE", reason: expect.stringContaining("no value") }),
    ]);

    const unlocked = await db.contactMethod.findFirst({
      where: { workspaceId: workspace.id, kind: "WORK_EMAIL" },
    });
    expect(unlocked?.isLocked).toBe(false);
    expect(unlocked?.revealedByUserId).toBe(ctx.userId);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).isRevealed).toBe(true);
  });

  it("never charges twice for the same idempotency key", async () => {
    const { ctx, workspace } = await freshWorkspace(10);
    const { lead, person } = await leadWithContacts(workspace.id, ctx.userId);
    // A second locked email so a retry would otherwise find something to charge.
    await db.contactMethod.create({
      data: {
        workspaceId: workspace.id,
        personId: person.id,
        kind: "PERSONAL_EMAIL",
        value: "p@personal.invalid",
        maskedValue: "p•••@personal.invalid",
        isLocked: true,
        status: "LIKELY",
        source: "Licensed dataset",
      },
    });

    const key = randomUUID();
    const first = await revealContacts(ctx, lead.id, { idempotencyKey: key });
    expect(first.pointsSpent).toBe(2);

    const balanceAfterFirst = await getBalance(workspace.id);
    // Same key again: the ledger rejects the duplicate, so nothing is charged.
    await revealContacts(ctx, lead.id, { idempotencyKey: key }).catch(() => undefined);
    expect(await getBalance(workspace.id)).toBe(balanceAfterFirst);
  });

  it("refuses and charges nothing when the balance is short", async () => {
    const { ctx, workspace } = await freshWorkspace(0);
    const { lead } = await leadWithContacts(workspace.id, ctx.userId);

    await expect(
      revealContacts(ctx, lead.id, { idempotencyKey: randomUUID() })
    ).rejects.toThrow(InsufficientPointsError);

    expect(await getBalance(workspace.id)).toBe(0);
    const stillLocked = await db.contactMethod.findFirst({
      where: { workspaceId: workspace.id, kind: "WORK_EMAIL" },
    });
    expect(stillLocked?.isLocked).toBe(true);
  });

  it("will not charge for a person who has opted out", async () => {
    const { ctx, workspace } = await freshWorkspace(10);
    const { lead, person } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.contactMethod.create({
      data: {
        workspaceId: workspace.id,
        personId: person.id,
        kind: "WORK_EMAIL",
        value: "no@example.invalid",
        maskedValue: "no•••",
        isLocked: true,
        status: "VERIFIED",
        source: "Licensed dataset",
        optedOutAt: new Date(),
      },
    });

    await expect(
      revealContacts(ctx, lead.id, { idempotencyKey: randomUUID() })
    ).rejects.toThrow(/No points were charged/);
    expect(await getBalance(workspace.id)).toBe(10);
  });

  it("says so rather than charging when nothing is locked", async () => {
    const { ctx, workspace } = await freshWorkspace(10);
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });

    await expect(
      revealContacts(ctx, lead.id, { idempotencyKey: randomUUID() })
    ).rejects.toThrow(/nothing locked left to reveal/i);
    expect(await getBalance(workspace.id)).toBe(10);
  });

  it("requires the reveal permission", async () => {
    const { workspace } = await freshWorkspace(10);
    const viewer = await addMember(workspace.id, "Viewer", "viewer");
    const { lead } = await leadWithContacts(workspace.id, viewer.userId);

    await expect(revealContacts(viewer, lead.id)).rejects.toThrow(ForbiddenError);
    expect(await getBalance(workspace.id)).toBe(10);
  });
});

describe("score override", () => {
  it("keeps the computed score alongside the override", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { score: 4 });

    const result = await overrideLeadScore(ctx, lead.id, {
      score: 8,
      reason: "We know this account; the signal understates it.",
    });

    expect(result.computedScore).toBe(4);
    expect(result.overriddenScore).toBe(8);

    const stored = await db.leadScore.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(Number(stored.displayScore)).toBe(4);
    expect(Number(stored.overriddenScore)).toBe(8);
    expect(stored.overriddenById).toBe(ctx.userId);
  });

  it("requires a reason, because the reason is the training signal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id);
    await expect(overrideLeadScore(ctx, lead.id, { score: 9 })).rejects.toThrow(
      /say why you disagree/
    );
  });

  it("clears an override without needing a reason", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { score: 5 });
    await overrideLeadScore(ctx, lead.id, { score: 9, reason: "because" });
    const cleared = await overrideLeadScore(ctx, lead.id, { score: null });
    expect(cleared.overriddenScore).toBeNull();
  });
});

describe("notes", () => {
  it("creates, pins and soft-deletes", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id);

    const note = await createNote(ctx, { leadId: lead.id, body: "CFO signs, not our contact." });
    expect(note.body).toContain("CFO signs");

    const pinned = await updateNote(ctx, note.id, { isPinned: true });
    expect(pinned.isPinned).toBe(true);

    await deleteNote(ctx, note.id);
    const row = await db.note.findUniqueOrThrow({ where: { id: note.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(
      await db.deletedRecord.count({ where: { objectType: "Note", objectId: note.id } })
    ).toBe(1);
  });

  it("requires a parent record", async () => {
    const { ctx } = await freshWorkspace();
    await expect(createNote(ctx, { body: "orphan" } as never)).rejects.toThrow();
  });

  it("refuses to attach a note to another workspace's lead", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const { lead } = await makeLead(b.workspace.id);
    await expect(createNote(a.ctx, { leadId: lead.id, body: "nope" })).rejects.toThrow(
      /doesn't exist, or you don't have access/
    );
  });

  it("stops one person editing another's note", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    const { lead } = await makeLead(workspace.id, { ownerId: rep.userId });
    const note = await createNote(ctx, { leadId: lead.id, body: "owner's note" });

    await expect(updateNote(rep, note.id, { body: "hijacked" })).rejects.toThrow(
      /only edit your own notes/
    );
  });
});

describe("tasks", () => {
  it("scores a hand-made task from what is actually known", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id);

    const task = await createTask(ctx, {
      title: "Confirm budget with finance",
      priority: "URGENT",
      leadId: lead.id,
      dueAt: new Date(Date.now() - 86_400_000),
    });

    expect(task.priorityScore).toBeGreaterThan(70);
    // The reason must not imply a model produced this rank.
    expect(task.priorityReason).toContain("Created by hand");
    expect(task.priorityReason).toContain("overdue");
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.createdByAi).toBe(false);
  });

  it("ranks an urgent task above a low one", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const urgent = await createTask(ctx, { title: "a", priority: "URGENT", companyId: undefined });
    const low = await createTask(ctx, { title: "b", priority: "LOW" });
    expect(urgent.priorityScore).toBeGreaterThan(low.priorityScore);
    void workspace;
  });

  it("keeps status and lane consistent", async () => {
    const { ctx } = await freshWorkspace();
    const task = await createTask(ctx, { title: "Follow up", priority: "MEDIUM" });

    const working = await updateTask(ctx, task.id, { lane: "IN_PROGRESS" });
    expect(working.status).toBe("WORKING");

    const done = await updateTask(ctx, task.id, { status: "DONE" });
    expect(done.lane).toBe("DONE");
    expect(done.completedAt).not.toBeNull();

    const reopened = await updateTask(ctx, task.id, { status: "QUEUED" });
    expect(reopened.completedAt).toBeNull();
  });

  it("stops a rep touching someone else's task", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    const mine = await createTask(ctx, { title: "owner task", priority: "LOW" });

    await expect(updateTask(rep, mine.id, { status: "DONE" })).rejects.toThrow(
      /belongs to someone else/
    );
  });

  it("soft-deletes into the recycle bin", async () => {
    const { ctx } = await freshWorkspace();
    const task = await createTask(ctx, { title: "Delete me", priority: "LOW" });
    await deleteTask(ctx, task.id);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).deletedAt).not.toBeNull();
    expect(
      await db.deletedRecord.count({ where: { objectType: "Task", objectId: task.id } })
    ).toBe(1);
  });
});

describe("deals", () => {
  async function pipelineFor(workspaceId: string) {
    const pipeline = await db.pipeline.create({
      data: { workspaceId, name: "P", isDefault: true },
    });
    for (const [i, name] of ["New", "Qualified", "Won"].entries()) {
      await db.pipelineStage.create({
        data: {
          workspaceId,
          pipelineId: pipeline.id,
          key: name.toLowerCase(),
          name,
          sortOrder: i,
          probability: i * 50,
          isWon: name === "Won",
        },
      });
    }
    return pipeline;
  }

  it("promotes a lead and opens the stage history with no origin", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await pipelineFor(workspace.id);
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });

    const deal = await createDeal(ctx, { leadId: lead.id, valueInr: 2_500_000 });
    expect(deal.valueInr).toBe(2_500_000);
    expect(deal.stage.name).toBe("New");

    // A null fromStageId marks "entered the pipeline", not a forward move.
    const history = await db.dealStageHistory.findFirstOrThrow({ where: { dealId: deal.id } });
    expect(history.fromStageId).toBeNull();

    // Promoting the lead moves it to QUALIFIED.
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("QUALIFIED");
  });

  it("refuses a second open deal for the same lead", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await pipelineFor(workspace.id);
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });

    await createDeal(ctx, { leadId: lead.id, valueInr: 100000 });
    await expect(createDeal(ctx, { leadId: lead.id, valueInr: 200000 })).rejects.toThrow(
      /already has an open deal/
    );
  });

  it("needs a lead or a company", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await pipelineFor(workspace.id);
    await expect(createDeal(ctx, { valueInr: 100000 })).rejects.toThrow(
      /needs either a lead or a company/
    );
  });

  it("resolves the missing-next-action flag when a next action is set", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await pipelineFor(workspace.id);
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const deal = await createDeal(ctx, { leadId: lead.id, valueInr: 500000 });

    await db.dealRisk.create({
      data: {
        workspaceId: workspace.id,
        dealId: deal.id,
        code: "no_next_action",
        severity: "medium",
        title: "No next action scheduled",
        explanation: "seeded for the test",
      },
    });

    await updateDeal(ctx, deal.id, { nextActionLabel: "Call procurement" });
    const risk = await db.dealRisk.findFirstOrThrow({
      where: { dealId: deal.id, code: "no_next_action" },
    });
    expect(risk.resolvedAt).not.toBeNull();
  });

  it("logs a value change as activity but a title change quietly", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await pipelineFor(workspace.id);
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const deal = await createDeal(ctx, { leadId: lead.id, valueInr: 500000 });

    await updateDeal(ctx, deal.id, { title: "Renamed" });
    expect(
      await db.activity.count({ where: { dealId: deal.id, kind: "deal.value_changed" } })
    ).toBe(0);

    await updateDeal(ctx, deal.id, { valueInr: 900000 });
    const activity = await db.activity.findFirstOrThrow({
      where: { dealId: deal.id, kind: "deal.value_changed" },
    });
    expect(activity.summary).toMatch(/₹5L → ₹9L/);
  });

  it("soft-deletes into the recycle bin", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await pipelineFor(workspace.id);
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const deal = await createDeal(ctx, { leadId: lead.id, valueInr: 500000 });

    await deleteDeal(ctx, deal.id);
    expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).deletedAt).not.toBeNull();
    expect(
      await db.deletedRecord.count({ where: { objectType: "Deal", objectId: deal.id } })
    ).toBe(1);
  });

  it("blocks a researcher from creating a deal", async () => {
    const { workspace } = await freshWorkspace();
    await pipelineFor(workspace.id);
    const researcher = await addMember(workspace.id, "Res", "researcher");
    const { lead } = await makeLead(workspace.id, { ownerId: researcher.userId });

    await expect(createDeal(researcher, { leadId: lead.id, valueInr: 100000 })).rejects.toThrow(
      ForbiddenError
    );
  });
});
