import { afterAll, describe, expect, it } from "vitest";
import { makeWorkspace, addMember, makeLead, cleanup, db } from "./helpers/fixtures";
import { logTouch, decideRecommendation } from "@/lib/services/lead-activity";
import { refreshNextBestActions } from "@/lib/queue/handlers/insights";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
async function workspace() {
  const w = await makeWorkspace("ActivityFixture");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  return w;
}

describe("logging touches", () => {
  it("records an outbound call on the timeline and the lead's contact dates, sending nothing", async () => {
    const w = await workspace();
    const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const r = await logTouch(w.ctx, lead.id, { channel: "PHONE", outcome: "no_answer", note: "Try Thursday" });
    expect(r).toMatchObject({ replied: false, sequencesStopped: 0 });
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.lastContactedAt).not.toBeNull();
    expect(after.repliedAt).toBeNull();
    const activity = await db.activity.findFirstOrThrow({ where: { leadId: lead.id, kind: "touch.outbound" } });
    expect(activity).toMatchObject({ channel: "PHONE", detail: "Try Thursday" });
    expect(activity.summary).toMatch(/Call to .* — no answer/);
    expect(await db.message.count({ where: { workspaceId: w.workspace.id } })).toBe(0);
  });

  it("marks a logged reply and stops only the sequences that stop on reply", async () => {
    const w = await workspace();
    const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const stops = await db.sequence.create({ data: { workspaceId: w.workspace.id, name: "Stops", stopOnReply: true } });
    const keeps = await db.sequence.create({ data: { workspaceId: w.workspace.id, name: "Keeps going", stopOnReply: false } });
    await db.sequenceEnrollment.createMany({ data: [
      { workspaceId: w.workspace.id, sequenceId: stops.id, leadId: lead.id, state: "active", nextSendAt: new Date() },
      { workspaceId: w.workspace.id, sequenceId: keeps.id, leadId: lead.id, state: "active", nextSendAt: new Date() },
    ] });
    const r = await logTouch(w.ctx, lead.id, { channel: "EMAIL", direction: "INBOUND", outcome: "replied" });
    expect(r).toMatchObject({ replied: true, sequencesStopped: 1 });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).repliedAt).not.toBeNull();
    const states = await db.sequenceEnrollment.findMany({ where: { leadId: lead.id }, include: { sequence: true } });
    expect(states.find((e) => e.sequence.name === "Stops")).toMatchObject({ state: "replied", nextSendAt: null });
    expect(states.find((e) => e.sequence.name === "Keeps going")?.state).toBe("active");
  });

  it("refuses a touch dated in the future", async () => {
    const w = await workspace();
    const { lead } = await makeLead(w.workspace.id);
    await expect(logTouch(w.ctx, lead.id, { channel: "PHONE", occurredAt: new Date(Date.now() + 86_400_000) })).rejects.toMatchObject({ code: "future_touch" });
  });

  it("cannot touch another workspace's lead, or a lead outside a rep's visibility", async () => {
    const a = await workspace(); const b = await workspace();
    const { lead } = await makeLead(a.workspace.id, { ownerId: a.user.id });
    await expect(logTouch(b.ctx, lead.id, { channel: "PHONE" })).rejects.toMatchObject({ status: 404 });
    const rep = await addMember(a.workspace.id, "ActivityRep", "sales_rep"); created.userIds.push(rep.userId);
    await expect(logTouch(rep, lead.id, { channel: "PHONE" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("recommendation decisions", () => {
  it("keeps a rejection through the nightly recompute and does not offer it again", async () => {
    const w = await workspace();
    const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await refreshNextBestActions(w.workspace.id, [lead.id]);
    const first = await db.nextBestAction.findFirstOrThrow({ where: { leadId: lead.id }, orderBy: { rank: "asc" } });
    await decideRecommendation(w.ctx, first.id, { decision: "rejected", feedback: "Already spoke last week" });

    await refreshNextBestActions(w.workspace.id, [lead.id]);
    const offered = await db.nextBestAction.findMany({ where: { leadId: lead.id, rejectedAt: null } });
    expect(offered.map((a) => a.action)).not.toContain(first.action);
    const kept = await db.nextBestAction.findFirstOrThrow({ where: { leadId: lead.id, action: first.action } });
    expect(kept).toMatchObject({ feedback: "Already spoke last week" });
    expect(kept.rejectedAt).not.toBeNull();
  });

  it("keeps a chosen recommendation's decision through the recompute", async () => {
    const w = await workspace();
    const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await refreshNextBestActions(w.workspace.id, [lead.id]);
    const first = await db.nextBestAction.findFirstOrThrow({ where: { leadId: lead.id }, orderBy: { rank: "asc" } });
    await decideRecommendation(w.ctx, first.id, { decision: "chosen" });
    await refreshNextBestActions(w.workspace.id, [lead.id]);
    expect((await db.nextBestAction.findFirstOrThrow({ where: { leadId: lead.id, action: first.action } })).chosenAt).not.toBeNull();
  });
});
