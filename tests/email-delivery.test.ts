import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/outreach/transport", async (original) => ({ ...(await original<typeof import("@/lib/outreach/transport")>()), sendEmail: vi.fn() }));
import { sendEmail } from "@/lib/outreach/transport";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { raiseNotification } from "@/lib/services/notify";
import { deliverNotificationEmails } from "@/lib/services/notification-email";
import { setNotificationEmail, setNotificationMuted } from "@/lib/services/notification-settings";
import { createInvitation, emailInvitation, assignableRoles } from "@/lib/services/team";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); vi.unstubAllEnvs(); });
beforeEach(() => { vi.mocked(sendEmail).mockReset().mockResolvedValue({ ok: true, providerMessageId: "<m@x>", adapter: "smtp" }); vi.unstubAllEnvs(); });
async function workspace() { const w = await makeWorkspace("EmailDelivery"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id); return w; }
const withMail = () => { vi.stubEnv("EMAIL_PROVIDER", "smtp"); vi.stubEnv("SMTP_URL", "smtp://u:p@mail.example:587"); vi.stubEnv("EMAIL_FROM", "noreply@contoso-synthetic.example"); };
const withoutMail = () => { vi.stubEnv("EMAIL_PROVIDER", ""); vi.stubEnv("SMTP_URL", ""); vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("EMAIL_FROM", ""); };
const raise = (w: Awaited<ReturnType<typeof workspace>>, title = "Hot lead: Meera") => raiseNotification({ data: { workspaceId: w.workspace.id, userId: w.user.id, kind: "HOT_LEAD", title, body: "Intent crossed into hot.", href: "/leads" } });

describe("notification email", () => {
  it("honours in-app and email preferences separately", async () => {
    const w = await workspace();
    await setNotificationMuted(w.ctx, "HOT_LEAD", true);
    expect(await raise(w)).toBe(false);
    await setNotificationEmail(w.ctx, "HOT_LEAD", true);
    expect(await raise(w)).toBe(true);
    expect(await db.notification.findFirstOrThrow({ where: { workspaceId: w.workspace.id } })).toMatchObject({ readAt: expect.any(Date) });
  });
  it("emails each opted-in notification once, not late, and nothing without a mail provider", async () => {
    const w = await workspace();
    await setNotificationEmail(w.ctx, "HOT_LEAD", true);
    await raise(w);
    await raiseNotification({ data: { workspaceId: w.workspace.id, userId: w.user.id, kind: "TASK_DUE", title: "Task due", body: "x" } });
    withoutMail();
    expect(await deliverNotificationEmails(w.workspace.id)).toMatchObject({ sent: 0, skipped: expect.stringContaining("No working email provider") });
    withMail();
    expect(await deliverNotificationEmails(w.workspace.id)).toMatchObject({ sent: 1 });
    expect(await deliverNotificationEmails(w.workspace.id)).toMatchObject({ sent: 0 });
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({ subject: "Hot lead: Meera", headers: { "Auto-Submitted": "auto-generated" } });
    const old = await db.notification.create({ data: { workspaceId: w.workspace.id, userId: w.user.id, kind: "HOT_LEAD", title: "Old", body: "x", createdAt: new Date(Date.now() - 2 * 86400000) } });
    await deliverNotificationEmails(w.workspace.id);
    expect(await db.notification.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ emailedAt: null });
  });
});

describe("invitation email", () => {
  it("records why it was not emailed, and emails when a provider works", async () => {
    const w = await workspace();
    const role = (await assignableRoles(w.ctx))[0];
    withoutMail();
    const a = await createInvitation(w.ctx, { email: "new.person@contoso-synthetic.example", roleId: role.id });
    expect(await emailInvitation(w.ctx, a.id, "http://localhost/invite/x")).toMatchObject({ emailed: false, note: expect.stringContaining("Send the link yourself") });
    expect(await db.invitation.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ emailedAt: null, emailError: expect.any(String) });
    withMail();
    expect(await emailInvitation(w.ctx, a.id, "http://localhost/invite/x")).toMatchObject({ emailed: true });
    expect(vi.mocked(sendEmail).mock.calls[0][0].text).toContain("http://localhost/invite/x");
  });
});
