import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, cleanup } from "./helpers/fixtures";
import { sweepNotifications } from "@/lib/queue/handlers/insights";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
const MIN = 60_000;

describe("task reminders", () => {
  it("notifies the owner of due and overdue tasks once, and skips snoozed and finished ones", async () => {
    const w = await makeWorkspace("Reminders");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const mk = (title: string, dueIn: number, extra: object = {}) => db.task.create({ data: { workspaceId: w.workspace.id, title, ownerId: w.user.id, leadId: lead.id, dueAt: new Date(Date.now() + dueIn * MIN), ...extra } });
    await mk("Call back Asha", 30);                                   // due soon
    await mk("Send revised scope", -120);                             // overdue
    await mk("Next week thing", 3 * 24 * 60);                         // not yet
    await mk("Snoozed one", -10, { snoozedUntil: new Date(Date.now() + 60 * MIN) });
    await mk("Finished one", -10, { status: "DONE" });

    await sweepNotifications(w.workspace.id);
    const titles = (await db.notification.findMany({ where: { workspaceId: w.workspace.id, kind: "TASK_DUE" }, select: { title: true } })).map((n) => n.title).sort();
    expect(titles).toEqual(["Due soon: Call back Asha", "Overdue: Send revised scope"]);

    await sweepNotifications(w.workspace.id);
    expect(await db.notification.count({ where: { workspaceId: w.workspace.id, kind: "TASK_DUE" } })).toBe(2);
  });
});
