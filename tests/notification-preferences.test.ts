import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, cleanup } from "./helpers/fixtures";
import { getNotificationSettings, setNotificationMuted } from "@/lib/services/notification-settings";
import { raiseNotification } from "@/lib/services/notify";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("notification preferences", () => {
  it("a mute stops that kind for that person only, and unmuting restores it", async () => {
    const w = await makeWorkspace("Prefs");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const colleague = await addMember(w.workspace.id, "PrefsColleague", "manager"); created.userIds.push(colleague.userId);
    const raise = (userId: string, kind: "DEAL_RISK" | "HOT_LEAD") => raiseNotification({ data: { workspaceId: w.workspace.id, userId, kind, title: "t", body: "b", severity: "info", href: "/" } });

    await setNotificationMuted(w.ctx, "DEAL_RISK", true);
    expect(await raise(w.user.id, "DEAL_RISK")).toBe(false);
    expect(await raise(w.user.id, "HOT_LEAD")).toBe(true);
    expect(await raise(colleague.userId, "DEAL_RISK")).toBe(true);
    expect((await getNotificationSettings(w.ctx)).kinds.find((k) => k.kind === "DEAL_RISK")?.muted).toBe(true);
    expect((await getNotificationSettings(colleague)).kinds.find((k) => k.kind === "DEAL_RISK")?.muted).toBe(false);

    await setNotificationMuted(w.ctx, "DEAL_RISK", false);
    expect(await raise(w.user.id, "DEAL_RISK")).toBe(true);
    await expect(setNotificationMuted(w.ctx, "NOT_A_KIND", true)).rejects.toMatchObject({ code: "unknown_kind" });
  });
});
