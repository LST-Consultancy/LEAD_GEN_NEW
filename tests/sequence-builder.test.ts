import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { createSequence, enrollLeads, listEnrollments, previewStep, unenrollLead, type SequenceInput } from "@/lib/services/sequences";
import { canReceiveReplies } from "@/lib/outreach/provider";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
async function workspace() {
  const w = await makeWorkspace("SeqBuilder");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  return w;
}
const EMAIL = { stepOrder: 1, dayOffset: 0, channel: "EMAIL" as const, subject: "Hello {{first_name}}", bodyTemplate: "Hi {{first_name}} at {{company}}." };
const seq = (over: Partial<SequenceInput> = {}): SequenceInput => ({ name: `Seq ${Math.random().toString(36).slice(2, 8)}`, stopOnReply: false, steps: [EMAIL], ...over });
async function reachableLead(workspaceId: string, ownerId: string) {
  const { lead, person } = await makeLead(workspaceId, { ownerId });
  await db.contactMethod.create({ data: { workspaceId, personId: person.id, kind: "WORK_EMAIL", value: `p${Math.random().toString(36).slice(2, 8)}@fixture.invalid`, maskedValue: "p***", isLocked: false, status: "VERIFIED", source: "fixture" } });
  return lead;
}

describe("sequence rules the builder relies on", () => {
  it("is created paused", async () => {
    const w = await workspace();
    const { sequence } = await createSequence(w.ctx, seq());
    expect(sequence.isActive).toBe(false);
  });

  it("refuses an automatic step on a channel with no sending path", async () => {
    const w = await workspace();
    await expect(createSequence(w.ctx, seq({ steps: [EMAIL, { stepOrder: 2, dayOffset: 3, channel: "WHATSAPP", isManualTask: false, bodyTemplate: "Hi" }] }))).rejects.toMatchObject({ code: "channel_not_automatic" });
    const ok = await createSequence(w.ctx, seq({ steps: [EMAIL, { stepOrder: 2, dayOffset: 3, channel: "WHATSAPP", isManualTask: true, bodyTemplate: "Hi {{first_name}}" }] }));
    expect(ok.sequence.id).toBeTruthy();
  });

  it("refuses steps that go backwards in days", async () => {
    const w = await workspace();
    await expect(createSequence(w.ctx, seq({ steps: [{ ...EMAIL, dayOffset: 5 }, { ...EMAIL, stepOrder: 2, dayOffset: 2 }] }))).rejects.toThrow();
  });

  it("does not claim replies are read when nothing reads them", () => {
    vi.stubEnv("EMAIL_PROVIDER", "smtp"); vi.stubEnv("SMTP_URL", "smtp://user:pass@localhost:2525");
    expect(canReceiveReplies()).toBe(false);
  });
});

describe("preview", () => {
  it("renders against a real lead and writes nothing", async () => {
    const w = await workspace();
    const lead = await reachableLead(w.workspace.id, w.user.id);
    const before = await Promise.all([db.message.count({ where: { workspaceId: w.workspace.id } }), db.task.count({ where: { workspaceId: w.workspace.id } })]);
    const p = await previewStep(w.ctx, { leadId: lead.id, subject: EMAIL.subject, bodyTemplate: EMAIL.bodyTemplate });
    expect(p?.body).not.toContain("{{");
    expect(p?.toAddress).toMatch(/@fixture\.invalid$/);
    expect(await Promise.all([db.message.count({ where: { workspaceId: w.workspace.id } }), db.task.count({ where: { workspaceId: w.workspace.id } })])).toEqual(before);
  });
});

describe("enrolments", () => {
  it("lists only enrolments the caller can see, and unenrol takes a lead out", async () => {
    const w = await workspace();
    const rep = await addMember(w.workspace.id, "SeqRep", "sales_rep"); created.userIds.push(rep.userId);
    const { sequence } = await createSequence(w.ctx, seq());
    const mine = await reachableLead(w.workspace.id, w.user.id);
    const theirs = await reachableLead(w.workspace.id, rep.userId);
    await enrollLeads(w.ctx, sequence.id, { leadIds: [mine.id, theirs.id] });
    expect((await listEnrollments(w.ctx, sequence.id))?.map((e) => e.lead.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect((await listEnrollments(rep, sequence.id))?.map((e) => e.lead.id)).toEqual([theirs.id]);

    await unenrollLead(w.ctx, sequence.id, mine.id);
    const after = await listEnrollments(w.ctx, sequence.id);
    expect(after?.find((e) => e.lead.id === mine.id)?.state).not.toBe("active");
  });

  it("returns nothing for another workspace's sequence", async () => {
    const w = await workspace(); const other = await workspace();
    const { sequence } = await createSequence(other.ctx, seq());
    expect(await listEnrollments(w.ctx, sequence.id)).toBeNull();
  });
});
