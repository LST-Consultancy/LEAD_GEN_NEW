import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import {
  listConversations,
  getConversation,
  getInboxCounts,
  getMailboxStatus,
} from "@/lib/services/inbox";
import {
  replyToConversation,
  setConversationState,
  setConversationRead,
  assignConversation,
  decideOnMessage,
  suppressAddress,
} from "@/lib/services/inbox-mutations";
import {
  createSequence,
  updateSequence,
  setSequenceActive,
  enrollLeads,
  unenrollLead,
  listSequences,
  previewStep,
  type SequenceInput,
} from "@/lib/services/sequences";
import {
  advanceSequences,
  sendMessage,
  wakeSnoozedConversations,
} from "@/lib/queue/handlers/outreach";

import { ForbiddenError } from "@/lib/auth/context";
import { resolveRecipient, suppressionLookup } from "@/lib/outreach/recipient";
import { dispositionOf, checkSendable } from "@/lib/outreach/sendability";

/**
 * Pretends a Gmail mailbox is connected. Gmail is the one that can read
 * replies, so stop-on-reply is allowed with it. Used only by the tests that
 * exercise what happens *past* the "nothing is connected" gate.
 */
function withMailbox() {
  vi.stubEnv("EMAIL_PROVIDER", "gmail");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Outreach");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

/** A lead with a real, unlocked email address. */
async function leadWithEmail(
  workspaceId: string,
  ownerId: string,
  over: { email?: string; optedOut?: boolean; bounces?: number; name?: string } = {}
) {
  const { lead, person, company } = await makeLead(workspaceId, {
    ownerId,
    name: over.name,
  });
  const email = over.email ?? `p-${lead.id.slice(0, 8)}@example.test`;
  await db.contactMethod.create({
    data: {
      workspaceId,
      personId: person.id,
      kind: "WORK_EMAIL",
      value: email,
      maskedValue: "p•••@example.test",
      isLocked: false,
      status: "VERIFIED",
      confidence: 90,
      source: "test",
      optedOutAt: over.optedOut ? new Date() : null,
      bounceCount: over.bounces ?? 0,
    },
  });
  return { lead, person, company, email };
}

async function conversationFor(
  workspaceId: string,
  leadId: string,
  companyId: string,
  over: { state?: string; isUnread?: boolean; inboundFrom?: string } = {}
) {
  const conversation = await db.conversation.create({
    data: {
      workspaceId,
      channel: "EMAIL",
      subject: "About your CRM rollout",
      state: (over.state ?? "NEEDS_YOU") as never,
      leadId,
      companyId,
      isUnread: over.isUnread ?? true,
    },
  });
  await db.message.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      direction: "INBOUND",
      channel: "EMAIL",
      state: "REPLIED",
      fromAddress: over.inboundFrom ?? "them@example.test",
      toAddress: "us@example.test",
      subject: "About your CRM rollout",
      body: "Yes, send over some times.",
    },
  });
  return conversation;
}

const SEQ: SequenceInput = {
  name: "Manufacturing first touch",
  steps: [
    {
      stepOrder: 1,
      dayOffset: 0,
      channel: "EMAIL",
      subject: "Quick question about {{company}}",
      bodyTemplate: "Hi {{first_name}}, we work with manufacturers. Worth a short call?",
    },
    {
      stepOrder: 2,
      dayOffset: 3,
      channel: "EMAIL",
      subject: "Following up, {{first_name}}",
      bodyTemplate: "Hi {{first_name}}, bumping this in case it got buried. Still worth a look?",
    },
  ],
};

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("inbox reads", () => {
  it("lists conversations newest first with a preview of the last message", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    await conversationFor(workspace.id, lead.id, company.id);

    const rows = await listConversations(ctx, { filter: "needs_you" });
    expect(rows).toHaveLength(1);
    expect(rows[0].lastMessage?.preview).toContain("send over some times");
    expect(rows[0].lastMessage?.direction).toBe("INBOUND");
    expect(rows[0].messageCount).toBe(1);
  });

  it("counts each filter bucket", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const a = await leadWithEmail(workspace.id, ctx.userId);
    const b = await leadWithEmail(workspace.id, ctx.userId);
    await conversationFor(workspace.id, a.lead.id, a.company.id, { state: "NEEDS_YOU" });
    await conversationFor(workspace.id, b.lead.id, b.company.id, {
      state: "WAITING",
      isUnread: false,
    });

    const counts = await getInboxCounts(ctx);
    expect(counts).toMatchObject({ needs_you: 1, waiting: 1, all: 2, unread: 1 });
  });

  it("hides a thread whose lead the viewer cannot see", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    // Owned by the owner, so the rep must not see the thread.
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    await conversationFor(workspace.id, lead.id, company.id);

    expect(await listConversations(ctx)).toHaveLength(1);
    expect(await listConversations(rep)).toHaveLength(0);
    expect((await getInboxCounts(rep)).all).toBe(0);
  });

  it("returns null rather than leaking a thread from another workspace", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const { lead, company } = await leadWithEmail(b.workspace.id, b.ctx.userId);
    const conversation = await conversationFor(b.workspace.id, lead.id, company.id);

    expect(await getConversation(a.ctx, conversation.id)).toBeNull();
    expect(await getConversation(b.ctx, conversation.id)).not.toBeNull();
  });

  it("puts messages oldest first on the detail view", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);
    await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        state: "SENT",
        body: "Later message",
        toAddress: "them@example.test",
      },
    });

    const detail = await getConversation(ctx, conversation.id);
    expect(detail?.messages.map((m) => m.body)).toEqual([
      "Yes, send over some times.",
      "Later message",
    ]);
  });

  it("reports the mailbox as unconfigured rather than implying mail can arrive", async () => {
    const { ctx } = await freshWorkspace();
    const status = await getMailboxStatus(ctx);
    expect(status.configured).toBe(false);
    expect(status.provider).toBeNull();
    expect(status.canReceive).toBe(false);
  });
});

describe("replying", () => {
  it("saves a draft and says nothing was sent when no provider is connected", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);

    const result = await replyToConversation(ctx, conversation.id, {
      body: "Thursday at 3pm works. Does that suit you?",
    });

    expect(result.sent).toBe(false);
    expect(result.message.state).toBe("DRAFT");
    expect(result.note).toMatch(/Saved as a draft/);
    expect(result.note).toMatch(/nothing can be sent/i);
  });

  it("does not claim the thread is waiting on them when nothing was sent", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);
    await replyToConversation(ctx, conversation.id, { body: "Shall we speak Thursday?" });

    const after = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.state).toBe("NEEDS_YOU");
  });

  it("addresses the reply to whoever wrote last", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id, {
      inboundFrom: "priya@konkan.test",
    });

    const result = await replyToConversation(ctx, conversation.id, { body: "Does Thursday work?" });
    expect(result.message.toAddress).toBe("priya@konkan.test");
  });

  it("prefixes the subject with Re: once, not twice", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await db.conversation.create({
      data: { workspaceId: workspace.id, channel: "EMAIL", leadId: lead.id, companyId: company.id },
    });
    await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        channel: "EMAIL",
        state: "REPLIED",
        fromAddress: "them@example.test",
        subject: "Re: CRM rollout",
        body: "Sounds good.",
      },
    });

    const result = await replyToConversation(ctx, conversation.id, { body: "Great — Thursday?" });
    expect(result.message.subject).toBe("Re: CRM rollout");
  });

  it("refuses a thread with no address to reply to", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await db.conversation.create({
      data: { workspaceId: workspace.id, channel: "EMAIL", leadId: lead.id, companyId: company.id },
    });
    await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        channel: "IN_PERSON",
        state: "REPLIED",
        body: "Spoke at the expo.",
      },
    });

    await expect(replyToConversation(ctx, conversation.id, { body: "Following up." })).rejects.toThrow(
      /no address to reply to/
    );
  });

  it("returns advisory copy warnings without blocking", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);

    const result = await replyToConversation(ctx, conversation.id, { body: "ok" });
    expect(result.copyWarnings.map((w) => w.code)).toContain("no_ask");
  });

  it("requires the send permission", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);
    // A researcher is explicitly not allowed to contact prospects.
    const researcher = await addMember(workspace.id, "Researcher", "researcher");
    await db.lead.update({ where: { id: lead.id }, data: { ownerId: researcher.userId } });

    await expect(
      replyToConversation(researcher, conversation.id, { body: "Can we talk Thursday?" })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("conversation state", () => {
  it("requires a future date to snooze", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);

    await expect(
      setConversationState(ctx, conversation.id, { state: "SNOOZED" })
    ).rejects.toThrow(/needs a date/);
    await expect(
      setConversationState(ctx, conversation.id, {
        state: "SNOOZED",
        snoozedUntil: new Date(Date.now() - 1000),
      })
    ).rejects.toThrow(/already passed/);
  });

  it("clears the snooze time when leaving the snoozed state", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);

    await setConversationState(ctx, conversation.id, {
      state: "SNOOZED",
      snoozedUntil: new Date(Date.now() + 86_400_000),
    });
    await setConversationState(ctx, conversation.id, { state: "OPEN" });

    const after = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.snoozedUntil).toBeNull();
  });

  it("marks a closed thread as read", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id, {
      isUnread: true,
    });
    await setConversationState(ctx, conversation.id, { state: "CLOSED" });
    const after = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.isUnread).toBe(false);
  });

  it("toggles read without writing a team activity row", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);

    await setConversationRead(ctx, conversation.id, false);
    const activities = await db.activity.count({
      where: { workspaceId: workspace.id, kind: { contains: "read" } },
    });
    expect(activities).toBe(0);
  });

  it("refuses to assign to someone outside the workspace", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const { lead, company } = await leadWithEmail(a.workspace.id, a.ctx.userId);
    const conversation = await conversationFor(a.workspace.id, lead.id, company.id);

    await expect(assignConversation(a.ctx, conversation.id, b.ctx.userId)).rejects.toThrow(
      /not a member/
    );
  });

  it("wakes a snoozed thread once its time has passed", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);
    await db.conversation.update({
      where: { id: conversation.id },
      data: { state: "SNOOZED", snoozedUntil: new Date(Date.now() - 60_000), isUnread: false },
    });

    expect(await wakeSnoozedConversations(workspace.id)).toEqual({ woken: 1 });
    const after = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.state).toBe("NEEDS_YOU");
    expect(after.snoozedUntil).toBeNull();
    expect(after.isUnread).toBe(true);

    // Idempotent: a second pass finds nothing.
    expect(await wakeSnoozedConversations(workspace.id)).toEqual({ woken: 0 });
  });

  it("does not wake a thread whose snooze is still in the future", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);
    await db.conversation.update({
      where: { id: conversation.id },
      data: { state: "SNOOZED", snoozedUntil: new Date(Date.now() + 86_400_000) },
    });
    expect(await wakeSnoozedConversations(workspace.id)).toEqual({ woken: 0 });
  });
});

describe("approval queue", () => {
  async function pendingMessage(workspaceId: string, ownerId: string) {
    const { lead, company } = await leadWithEmail(workspaceId, ownerId);
    const conversation = await conversationFor(workspaceId, lead.id, company.id);
    return db.message.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        state: "PENDING_APPROVAL",
        toAddress: "them@example.test",
        subject: "Drafted for you",
        body: "Shall we speak on Thursday?",
        actorType: "AI",
        generatedByAi: true,
      },
    });
  }

  it("refuses to approve into a queue that cannot drain", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const message = await pendingMessage(workspace.id, ctx.userId);

    await expect(decideOnMessage(ctx, message.id, { decision: "approve" })).rejects.toThrow(
      /cannot drain/
    );
    // And it leaves the message alone rather than half-approving it.
    const after = await db.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.state).toBe("PENDING_APPROVAL");
  });

  it("rejects back to a draft, requiring a reason", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const message = await pendingMessage(workspace.id, ctx.userId);

    await expect(decideOnMessage(ctx, message.id, { decision: "reject" })).rejects.toThrow(
      /needs a reason/
    );

    const result = await decideOnMessage(ctx, message.id, {
      decision: "reject",
      reason: "Too generic — no mention of their tender.",
    });
    expect(result.message.state).toBe("DRAFT");
    expect(result.message.failureReason).toMatch(/Too generic/);
    expect(result.note).toMatch(/Nothing was sent/);
  });

  it("refuses to decide twice on the same message", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const message = await pendingMessage(workspace.id, ctx.userId);
    await decideOnMessage(ctx, message.id, { decision: "reject", reason: "Not right yet." });

    await expect(
      decideOnMessage(ctx, message.id, { decision: "reject", reason: "Again." })
    ).rejects.toThrow(/not waiting for approval/);
  });

  it("requires the approve permission, which a rep does not have", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const message = await pendingMessage(workspace.id, ctx.userId);
    const rep = await addMember(workspace.id, "Rep", "sales_rep");

    await expect(
      decideOnMessage(rep, message.id, { decision: "reject", reason: "No." })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("suppression", () => {
  it("records the reason and stops live enrollments to that address", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, email } = await leadWithEmail(workspace.id, ctx.userId);
    const { sequence } = await createSequence(ctx, SEQ);
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(),
      },
    });

    const result = await suppressAddress(ctx, {
      value: email,
      reason: "Asked to be removed",
    });

    expect(result.enrollmentsStopped).toBe(1);
    expect(result.note).toMatch(/do-not-contact/);
    const enrollment = await db.sequenceEnrollment.findFirstOrThrow({
      where: { sequenceId: sequence.id, leadId: lead.id },
    });
    expect(enrollment.state).toBe("stopped");
    expect(enrollment.stopReason).toMatch(/Asked to be removed/);
  });

  it("lower-cases the stored value so matching is case-insensitive", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const result = await suppressAddress(ctx, {
      value: "Priya@Example.Test",
      reason: "Bounced repeatedly",
    });
    expect(result.suppression.value).toBe("priya@example.test");
    expect(
      await db.suppression.count({ where: { workspaceId: workspace.id } })
    ).toBe(1);
  });

  it("is idempotent on the same address", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await suppressAddress(ctx, { value: "a@b.test", reason: "First reason" });
    await suppressAddress(ctx, { value: "a@b.test", reason: "Second reason" });

    const rows = await db.suppression.findMany({ where: { workspaceId: workspace.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("Second reason");
  });

  it("requires a reason", async () => {
    const { ctx } = await freshWorkspace();
    await expect(suppressAddress(ctx, { value: "a@b.test", reason: "" })).rejects.toThrow();
  });

  it("rejects an address with no @ under the email kind", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      suppressAddress(ctx, { value: "example.test", reason: "Whole company" })
    ).rejects.toThrow(/does not look like an email/);
  });

  it("says so plainly when nothing was live", async () => {
    const { ctx } = await freshWorkspace();
    const result = await suppressAddress(ctx, { value: "nobody@b.test", reason: "Preemptive" });
    expect(result.enrollmentsStopped).toBe(0);
    expect(result.note).toMatch(/No live sequences/);
  });
});

describe("sequences", () => {
  it("creates paused, so it cannot start emailing by accident", async () => {
    const { ctx } = await freshWorkspace();
    const result = await createSequence(ctx, SEQ);
    expect(result.sequence.isActive).toBe(false);
    expect(result.note).toMatch(/left paused/);
  });

  it("rejects a send window that never opens", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createSequence(ctx, { ...SEQ, sendWindowStart: 19, sendWindowEnd: 9 })
    ).rejects.toThrow(/nothing would ever send/);
  });

  it("rejects steps that go backwards in time", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createSequence(ctx, {
        ...SEQ,
        steps: [
          { ...SEQ.steps![0], dayOffset: 5 },
          { ...SEQ.steps![1], dayOffset: 1 },
        ],
      })
    ).rejects.toThrow(/move forward in time/);
  });

  it("rejects two emails on the same day", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createSequence(ctx, {
        ...SEQ,
        steps: [
          { ...SEQ.steps![0], dayOffset: 2 },
          { ...SEQ.steps![1], dayOffset: 2 },
        ],
      })
    ).rejects.toThrow(/reads as a mistake/);
  });

  it("allows a manual task alongside an email on the same day", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createSequence(ctx, {
        ...SEQ,
        steps: [
          { ...SEQ.steps![0], dayOffset: 2 },
          {
            stepOrder: 2,
            dayOffset: 2,
            channel: "PHONE",
            isManualTask: true,
            bodyTemplate: "Call {{first_name}} to follow the email.",
          },
        ],
      })
    ).resolves.toBeDefined();
  });

  it("rejects a template variable it cannot fill", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createSequence(ctx, {
        ...SEQ,
        steps: [{ ...SEQ.steps![0], bodyTemplate: "Hi {{frist_name}}, hello?" }],
      })
    ).rejects.toThrow(/would see the braces/);
  });

  it("rejects an email step with no subject", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createSequence(ctx, {
        ...SEQ,
        steps: [{ ...SEQ.steps![0], subject: undefined }],
      })
    ).rejects.toThrow(/no subject line/);
  });

  it("rejects a duplicate name", async () => {
    const { ctx } = await freshWorkspace();
    await createSequence(ctx, SEQ);
    await expect(createSequence(ctx, SEQ)).rejects.toThrow(/already exists/);
  });

  it("refuses to activate with no provider connected", async () => {
    const { ctx } = await freshWorkspace();
    const { sequence } = await createSequence(ctx, SEQ);
    await expect(setSequenceActive(ctx, sequence.id, true)).rejects.toThrow(
      /No email provider is connected/
    );
  });

  it("pausing also pauses everyone mid-sequence", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const { sequence } = await createSequence(ctx, SEQ);
    await db.sequence.update({ where: { id: sequence.id }, data: { isActive: true } });
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(),
      },
    });

    const result = await setSequenceActive(ctx, sequence.id, false);
    expect(result.note).toMatch(/1 live enrollment was paused/);
    const enrollment = await db.sequenceEnrollment.findFirstOrThrow({
      where: { sequenceId: sequence.id },
    });
    expect(enrollment.state).toBe("paused");
    // The clock is stopped, or resuming would fire every missed step at once.
    expect(enrollment.nextSendAt).toBeNull();
  });

  it("reports a reply rate of null rather than zero with no enrollments", async () => {
    const { ctx } = await freshWorkspace();
    await createSequence(ctx, SEQ);
    const [listed] = await listSequences(ctx);
    expect(listed.stats.enrolled).toBe(0);
    expect(listed.stats.replyRate).toBeNull();
  });

  it("counts replies per sequence, not the workspace total for every row", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const a = await createSequence(ctx, { ...SEQ, name: "Sequence A" });
    const b = await createSequence(ctx, { ...SEQ, name: "Sequence B" });
    const one = await leadWithEmail(workspace.id, ctx.userId);
    const two = await leadWithEmail(workspace.id, ctx.userId);
    await db.lead.update({ where: { id: one.lead.id }, data: { repliedAt: new Date() } });

    await db.sequenceEnrollment.createMany({
      data: [
        {
          workspaceId: workspace.id,
          sequenceId: a.sequence.id,
          leadId: one.lead.id,
          state: "active",
        },
        {
          workspaceId: workspace.id,
          sequenceId: b.sequence.id,
          leadId: two.lead.id,
          state: "active",
        },
      ],
    });

    const listed = await listSequences(ctx);
    const seqA = listed.find((x) => x.name === "Sequence A")!;
    const seqB = listed.find((x) => x.name === "Sequence B")!;
    expect(seqA.stats.replied).toBe(1);
    // Must not inherit A's reply.
    expect(seqB.stats.replied).toBe(0);
    expect(seqB.stats.replyRate).toBe(0);
  });

  it("counts a reply the engine has not processed yet", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { sequence } = await createSequence(ctx, SEQ);
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    // The lead replied; the engine has not run, so the enrollment row has no
    // repliedAt of its own. The rate must still reflect reality.
    await db.lead.update({ where: { id: lead.id }, data: { repliedAt: new Date() } });
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
      },
    });

    const [listed] = await listSequences(ctx);
    expect(listed.stats.replied).toBe(1);
    expect(listed.stats.replyRate).toBe(100);
  });

  it("describes its own schedule in words", async () => {
    const { ctx } = await freshWorkspace();
    await createSequence(ctx, SEQ);
    const [listed] = await listSequences(ctx);
    expect(listed.schedule).toBe("weekdays, 09:00–19:00 Asia/Kolkata, up to 50 a day");
  });

  it("keeps a step that already sent something, rather than orphaning history", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const { sequence } = await createSequence(ctx, SEQ);
    const step2 = await db.sequenceStep.findFirstOrThrow({
      where: { sequenceId: sequence.id, stepOrder: 2 },
    });
    const conversation = await conversationFor(workspace.id, lead.id, company.id);
    await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        state: "SENT",
        body: "Step 2 went out",
        sequenceStepId: step2.id,
      },
    });

    // Save a one-step version; step 2 must survive because a message cites it.
    await updateSequence(ctx, sequence.id, { ...SEQ, steps: [SEQ.steps![0]] });
    expect(
      await db.sequenceStep.count({ where: { sequenceId: sequence.id, stepOrder: 2 } })
    ).toBe(1);
  });

  it("removes an unused step on save", async () => {
    const { ctx } = await freshWorkspace();
    const { sequence } = await createSequence(ctx, SEQ);
    await updateSequence(ctx, sequence.id, { ...SEQ, steps: [SEQ.steps![0]] });
    expect(
      await db.sequenceStep.count({ where: { sequenceId: sequence.id, stepOrder: 2 } })
    ).toBe(0);
  });

  it("warns that people mid-sequence will get the edited copy", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const { sequence } = await createSequence(ctx, SEQ);
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
      },
    });

    const result = await updateSequence(ctx, sequence.id, SEQ);
    expect(result.note).toMatch(/part-way through/);
  });
});

describe("enrolling", () => {
  it("refuses a lead with no email address, and says why", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { sequence } = await createSequence(ctx, {
      ...SEQ,
      stopOnReply: false,
    });

    await expect(enrollLeads(ctx, sequence.id, { leadIds: [lead.id] })).rejects.toThrow(
      /No email address on this lead/
    );
  });

  it("refuses a suppressed lead", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, email } = await leadWithEmail(workspace.id, ctx.userId);
    await suppressAddress(ctx, { value: email, reason: "Asked to be removed" });
    const { sequence } = await createSequence(ctx, { ...SEQ, stopOnReply: false });

    await expect(enrollLeads(ctx, sequence.id, { leadIds: [lead.id] })).rejects.toThrow(
      /do-not-contact/
    );
  });

  it("refuses a lead who already replied", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    await db.lead.update({ where: { id: lead.id }, data: { repliedAt: new Date() } });
    const { sequence } = await createSequence(ctx, SEQ);
    await db.sequence.update({ where: { id: sequence.id }, data: { stopOnReply: true } });

    await expect(enrollLeads(ctx, sequence.id, { leadIds: [lead.id] })).rejects.toThrow(
      /already replied/
    );
  });

  it("refuses an address that has opted out on the contact record", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId, { optedOut: true });
    const { sequence } = await createSequence(ctx, { ...SEQ, stopOnReply: false });

    await expect(enrollLeads(ctx, sequence.id, { leadIds: [lead.id] })).rejects.toThrow(
      /do-not-contact|Unsubscribed/
    );
  });

  it("refuses an address that has hard-bounced three times", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId, { bounces: 3 });
    const { sequence } = await createSequence(ctx, { ...SEQ, stopOnReply: false });

    // Reported as a wrong address, not as a missing one and not as an opt-out.
    await expect(enrollLeads(ctx, sequence.id, { leadIds: [lead.id] })).rejects.toThrow(
      /address is wrong/
    );
  });

  it("enrolls the good ones and reports each rejection", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const good = await leadWithEmail(workspace.id, ctx.userId, { name: "Good Lead" });
    const noEmail = await makeLead(workspace.id, { ownerId: ctx.userId, name: "No Email" });
    const { sequence } = await createSequence(ctx, { ...SEQ, stopOnReply: false });

    const result = await enrollLeads(ctx, sequence.id, {
      leadIds: [good.lead.id, noEmail.lead.id],
    });

    expect(result.enrolled).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].name).toBe("No Email");
    expect(result.note).toMatch(/Nothing sends until a mailbox is connected/);
  });

  it("does not enroll the same lead twice", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const { sequence } = await createSequence(ctx, { ...SEQ, stopOnReply: false });
    await enrollLeads(ctx, sequence.id, { leadIds: [lead.id] });

    await expect(enrollLeads(ctx, sequence.id, { leadIds: [lead.id] })).rejects.toThrow(
      /Already active/
    );
  });

  it("will not enroll a lead the caller cannot see", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    const { sequence } = await createSequence(ctx, { ...SEQ, stopOnReply: false });

    await expect(enrollLeads(rep, sequence.id, { leadIds: [lead.id] })).rejects.toThrow(
      /don't have access/
    );
  });

  it("removing a lead keeps what already went out", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const { sequence } = await createSequence(ctx, { ...SEQ, stopOnReply: false });
    await enrollLeads(ctx, sequence.id, { leadIds: [lead.id] });

    const result = await unenrollLead(ctx, sequence.id, lead.id);
    expect(result.note).toMatch(/stay on the timeline/);
    expect(result.enrollment.state).toBe("stopped");
    expect(result.enrollment.nextSendAt).toBeNull();
  });
});

describe("previewStep", () => {
  it("renders against a real lead using the same renderer as the engine", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId, { name: "Priya Menon" });

    const preview = await previewStep(ctx, {
      leadId: lead.id,
      subject: "Quick question about {{company}}",
      bodyTemplate: "Hi {{first_name}}, worth a short call?",
    });

    expect(preview?.body).toBe("Hi Priya, worth a short call?");
    expect(preview?.unresolved).toEqual([]);
    expect(preview?.toAddress).toContain("@");
  });

  it("names the variables a lead cannot fill instead of rendering a blank", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    // No signal on this lead.
    const preview = await previewStep(ctx, {
      leadId: lead.id,
      subject: "About your {{signal}}",
      bodyTemplate: "Hi {{first_name}}, I saw {{signal}}.",
    });

    expect(preview?.unresolved).toEqual(["signal"]);
    expect(preview?.body).toContain("{{signal}}");
  });

  it("returns null for a lead outside the tenant", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const { lead } = await leadWithEmail(b.workspace.id, b.ctx.userId);
    expect(await previewStep(a.ctx, { leadId: lead.id, bodyTemplate: "Hi" })).toBeNull();
  });

  it("reports that sending is not configured", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const preview = await previewStep(ctx, { leadId: lead.id, bodyTemplate: "Hi {{first_name}}" });
    expect(preview?.configured).toBe(false);
    expect(preview?.provider).toBeNull();
  });
});

describe("the engine", () => {
  async function activeSequenceWith(
    workspaceId: string,
    ownerId: string,
    over: Partial<{ stopOnReply: boolean; sendDays: number[]; dailyCap: number }> = {}
  ) {
    const sequence = await db.sequence.create({
      data: {
        workspaceId,
        name: `Seq ${Math.random().toString(36).slice(2, 8)}`,
        isActive: true,
        stopOnReply: over.stopOnReply ?? false,
        sendWindowStart: 0,
        sendWindowEnd: 24,
        sendDays: over.sendDays ?? [1, 2, 3, 4, 5, 6, 7],
        dailyCap: over.dailyCap ?? 50,
        steps: {
          create: [
            {
              workspaceId,
              stepOrder: 1,
              dayOffset: 0,
              channel: "EMAIL",
              subject: "Quick question about {{company}}",
              bodyTemplate: "Hi {{first_name}}, worth a short call?",
            },
            {
              workspaceId,
              stepOrder: 2,
              dayOffset: 3,
              channel: "EMAIL",
              subject: "Following up",
              bodyTemplate: "Hi {{first_name}}, bumping this. Still worth a look?",
            },
          ],
        },
      },
      include: { steps: true },
    });
    return sequence;
  }

  it("queues the first step and advances the enrollment", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId, { name: "Priya Menon" });
    const sequence = await activeSequenceWith(workspace.id, ctx.userId);
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await advanceSequences(workspace.id);
    expect(result.queued).toBe(1);

    const message = await db.message.findFirstOrThrow({
      where: { workspaceId: workspace.id, direction: "OUTBOUND" },
    });
    expect(message.state).toBe("QUEUED");
    expect(message.body).toBe("Hi Priya, worth a short call?");
    expect(message.actorType).toBe("SYSTEM");

    const enrollment = await db.sequenceEnrollment.findFirstOrThrow({
      where: { sequenceId: sequence.id },
    });
    expect(enrollment.currentStep).toBe(1);
    expect(enrollment.nextSendAt).not.toBeNull();
  });

  it("is idempotent — a second pass finds nothing due", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const sequence = await activeSequenceWith(workspace.id, ctx.userId);
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(Date.now() - 60_000),
      },
    });

    await advanceSequences(workspace.id);
    const after = await advanceSequences(workspace.id);
    expect(after.queued).toBe(0);
    expect(
      await db.message.count({ where: { workspaceId: workspace.id, direction: "OUTBOUND" } })
    ).toBe(1);
  });

  it("stops rather than sending when the lead replied since enrolling", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const sequence = await activeSequenceWith(workspace.id, ctx.userId, { stopOnReply: true });
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(Date.now() - 60_000),
      },
    });
    await db.lead.update({ where: { id: lead.id }, data: { repliedAt: new Date() } });

    const result = await advanceSequences(workspace.id);
    expect(result.queued).toBe(0);
    expect(result.stopped).toBe(1);

    const enrollment = await db.sequenceEnrollment.findFirstOrThrow({
      where: { sequenceId: sequence.id },
    });
    expect(enrollment.state).toBe("stopped");
    expect(enrollment.stopReason).toMatch(/already replied/);
  });

  it("reschedules rather than stopping when only the clock is in the way", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    // No sending days that include today: the blocker is purely temporal.
    const today = new Date().getUTCDay();
    const notToday = [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== (today === 0 ? 7 : today));
    const sequence = await activeSequenceWith(workspace.id, ctx.userId, { sendDays: notToday });
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await advanceSequences(workspace.id);
    expect(result.rescheduled).toBe(1);
    expect(result.stopped).toBe(0);

    const enrollment = await db.sequenceEnrollment.findFirstOrThrow({
      where: { sequenceId: sequence.id },
    });
    // Still active, still on step 0 — the step was not consumed.
    expect(enrollment.state).toBe("active");
    expect(enrollment.currentStep).toBe(0);
    expect(enrollment.nextSendAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("creates a task instead of a message for a manual step", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId, { name: "Priya Menon" });
    const sequence = await db.sequence.create({
      data: {
        workspaceId: workspace.id,
        name: "Call first",
        isActive: true,
        sendWindowStart: 0,
        sendWindowEnd: 24,
        sendDays: [1, 2, 3, 4, 5, 6, 7],
        steps: {
          create: [
            {
              workspaceId: workspace.id,
              stepOrder: 1,
              dayOffset: 0,
              channel: "PHONE",
              isManualTask: true,
              subject: "Call {{first_name}}",
              bodyTemplate: "Ring {{first_name}} at {{company}} about the rollout.",
            },
          ],
        },
      },
    });
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(Date.now() - 60_000),
      },
    });

    await advanceSequences(workspace.id);
    const task = await db.task.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(task.title).toBe("Call Priya");
    expect(task.channel).toBe("PHONE");
    expect(
      await db.message.count({ where: { workspaceId: workspace.id, direction: "OUTBOUND" } })
    ).toBe(0);
  });

  it("completes the enrollment after the last step", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const sequence = await activeSequenceWith(workspace.id, ctx.userId);
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        // Already past step 1.
        currentStep: 1,
        nextSendAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await advanceSequences(workspace.id);
    expect(result.completed).toBe(1);
    const enrollment = await db.sequenceEnrollment.findFirstOrThrow({
      where: { sequenceId: sequence.id },
    });
    expect(enrollment.state).toBe("completed");
    expect(enrollment.nextSendAt).toBeNull();
  });

  it("keeps a sequence's steps in one conversation thread", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const sequence = await activeSequenceWith(workspace.id, ctx.userId);
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(Date.now() - 60_000),
      },
    });

    await advanceSequences(workspace.id);
    await db.sequenceEnrollment.updateMany({
      where: { sequenceId: sequence.id },
      data: { nextSendAt: new Date(Date.now() - 60_000) },
    });
    await advanceSequences(workspace.id);

    expect(await db.conversation.count({ where: { workspaceId: workspace.id } })).toBe(1);
    expect(
      await db.message.count({ where: { workspaceId: workspace.id, direction: "OUTBOUND" } })
    ).toBe(2);
  });

  it("takes the oldest-due enrollments first", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const sequence = await activeSequenceWith(workspace.id, ctx.userId);
    const older = await leadWithEmail(workspace.id, ctx.userId, { name: "Older Due" });
    const newer = await leadWithEmail(workspace.id, ctx.userId, { name: "Newer Due" });

    await db.sequenceEnrollment.createMany({
      data: [
        {
          workspaceId: workspace.id,
          sequenceId: sequence.id,
          leadId: newer.lead.id,
          state: "active",
          nextSendAt: new Date(Date.now() - 60_000),
        },
        {
          workspaceId: workspace.id,
          sequenceId: sequence.id,
          leadId: older.lead.id,
          state: "active",
          nextSendAt: new Date(Date.now() - 600_000),
        },
      ],
    });

    await advanceSequences(workspace.id);
    const messages = await db.message.findMany({
      where: { workspaceId: workspace.id, direction: "OUTBOUND" },
      orderBy: { createdAt: "asc" },
      select: { body: true },
    });
    // Both go out, but the one waiting longest is handled first — which is
    // what matters when a cap or a batch limit cuts the pass short.
    expect(messages[0].body).toContain("Older");
  });

  it("does not touch another workspace's enrollments", async () => {
    withMailbox();
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const { lead } = await leadWithEmail(b.workspace.id, b.ctx.userId);
    const sequence = await activeSequenceWith(b.workspace.id, b.ctx.userId);
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: b.workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(Date.now() - 60_000),
      },
    });

    expect((await advanceSequences(a.workspace.id)).considered).toBe(0);
    expect((await advanceSequences(b.workspace.id)).considered).toBe(1);
  });
});

describe("sendMessage", () => {
  it("fails honestly rather than marking an undeliverable message as sent", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);
    const message = await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        state: "QUEUED",
        toAddress: "them@example.test",
        body: "Shall we speak Thursday?",
      },
    });

    const result = await sendMessage(workspace.id, message.id);
    expect(result.sent).toBe(false);

    const after = await db.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.state).toBe("FAILED");
    expect(after.sentAt).toBeNull();
    // Accurate about which part is missing: gmail is configured here, but only
    // SMTP and Resend have an adapter — so the message names the provider that
    // cannot send *and* the ones that can, which is the actionable part.
    expect(after.failureReason).toMatch(/gmail/);
    expect(after.failureReason).toMatch(/delivery adapter/);
    expect(after.failureReason).toMatch(/smtp/);
    expect(after.failureReason).toMatch(/Nothing was sent/);
  });

  it("holds a queued message rather than failing it when no mailbox is connected", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);
    const message = await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        state: "QUEUED",
        toAddress: "them@example.test",
        body: "Shall we speak Thursday?",
      },
    });

    const result = await sendMessage(workspace.id, message.id);
    expect(result.disposition).toBe("hold");
    expect(result.willRetry).toBe(true);
    // Still queued, so connecting a mailbox is all it takes.
    const after = await db.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.state).toBe("QUEUED");
  });

  it("leaves a message alone that is not queued, so a redelivery cannot duplicate a send", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);
    const message = await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        state: "SENT",
        toAddress: "them@example.test",
        body: "Already gone.",
        sentAt: new Date(),
      },
    });

    expect(await sendMessage(workspace.id, message.id)).toEqual({
      skipped: "not_queued",
      state: "SENT",
    });
    const after = await db.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.state).toBe("SENT");
  });

  it("re-checks suppression at send time, not just at queue time", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company, email } = await leadWithEmail(workspace.id, ctx.userId);
    const conversation = await conversationFor(workspace.id, lead.id, company.id);
    const message = await db.message.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        state: "QUEUED",
        toAddress: email,
        body: "Shall we speak Thursday?",
      },
    });
    // They unsubscribe in the window between queueing and sending.
    await db.suppression.create({
      data: {
        workspaceId: workspace.id,
        kind: "email",
        value: email.toLowerCase(),
        reason: "Unsubscribed via link",
        source: "footer",
      },
    });

    const result = await sendMessage(workspace.id, message.id);
    expect(result.blocked).toContain("unsubscribed");
    const after = await db.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.state).toBe("FAILED");
  });

  it("handles a missing message without throwing", async () => {
    const { workspace } = await freshWorkspace();
    expect(await sendMessage(workspace.id, crypto.randomUUID())).toEqual({
      skipped: "message_missing",
    });
  });
});

describe("resolveRecipient", () => {
  const listed = suppressionLookup([
    { kind: "email", value: "blocked@x.test", reason: "Asked to stop", source: "reply" },
    { kind: "domain", value: "nope.test", reason: "Competitor", source: "manual" },
  ]);

  it("picks the first usable address", () => {
    expect(
      resolveRecipient(
        [{ value: "a@x.test", optedOutAt: null, bounceCount: 0 }],
        { listed: () => null }
      )
    ).toEqual({ toAddress: "a@x.test", suppression: null });
  });

  it("skips an opted-out address in favour of a usable one", () => {
    const r = resolveRecipient(
      [
        { value: "old@x.test", optedOutAt: new Date(), bounceCount: 0 },
        { value: "new@x.test", optedOutAt: null, bounceCount: 0 },
      ],
      { listed: () => null }
    );
    expect(r.toAddress).toBe("new@x.test");
  });

  it("reports the opt-out rather than pretending no address exists", () => {
    const r = resolveRecipient(
      [{ value: "old@x.test", optedOutAt: new Date(), bounceCount: 0 }],
      { listed: () => null }
    );
    expect(r.toAddress).toBeNull();
    expect(r.suppression?.reason).toMatch(/Unsubscribed/);
    expect(r.suppression?.source).toBe("contact record");
  });

  it("reports repeated bounces as a wrong address, not an opt-out", () => {
    const r = resolveRecipient(
      [{ value: "old@x.test", optedOutAt: null, bounceCount: 4 }],
      { listed: () => null }
    );
    expect(r.suppression?.reason).toMatch(/address is wrong/);
    expect(r.suppression?.source).toBe("delivery reports");
  });

  it("reports nothing when there is genuinely no address", () => {
    expect(resolveRecipient([], { listed: () => null })).toEqual({
      toAddress: null,
      suppression: null,
    });
    // A locked contact has a null value, which is not an address.
    expect(
      resolveRecipient([{ value: null, optedOutAt: null, bounceCount: 0 }], {
        listed: () => null,
      }).toAddress
    ).toBeNull();
  });

  it("returns a usable address together with its workspace suppression", () => {
    const r = resolveRecipient(
      [{ value: "blocked@x.test", optedOutAt: null, bounceCount: 0 }],
      { listed }
    );
    // The address resolves, but carries the reason it may not be used.
    expect(r.toAddress).toBe("blocked@x.test");
    expect(r.suppression?.reason).toBe("Asked to stop");
  });

  it("matches a suppressed domain", () => {
    const r = resolveRecipient(
      [{ value: "anyone@nope.test", optedOutAt: null, bounceCount: 0 }],
      { listed }
    );
    expect(r.suppression?.reason).toBe("Competitor");
  });

  it("is case-insensitive on the lookup", () => {
    const r = resolveRecipient(
      [{ value: "Blocked@X.test", optedOutAt: null, bounceCount: 0 }],
      { listed }
    );
    expect(r.suppression?.reason).toBe("Asked to stop");
  });
});

describe("dispositionOf", () => {
  const blocker = (scope: "schedule" | "config" | "sequence" | "lead") => ({
    code: "no_provider" as const,
    message: "",
    scope,
    waitsForClock: scope === "schedule",
  });

  it("sends when nothing blocks", () => {
    expect(dispositionOf([])).toBe("send");
  });

  it("stops only for a lead-scoped blocker", () => {
    expect(dispositionOf([blocker("lead")])).toBe("stop");
    // A lead blocker wins over any wait: the lead is unreachable regardless.
    expect(dispositionOf([blocker("schedule"), blocker("lead")])).toBe("stop");
  });

  it("holds for configuration, so enrollments survive a missing mailbox", () => {
    expect(dispositionOf([blocker("config")])).toBe("hold");
    expect(dispositionOf([blocker("sequence")])).toBe("hold");
    // A hold outranks a reschedule — rescheduling implies the clock will fix
    // it, which it will not.
    expect(dispositionOf([blocker("schedule"), blocker("config")])).toBe("hold");
  });

  it("reschedules when only the clock is in the way", () => {
    expect(dispositionOf([blocker("schedule")])).toBe("reschedule");
  });
});

describe("no_address versus suppression", () => {
  it("does not report a missing address when a suppression explains it", () => {
    const { blockers } = checkSendable({
      providerConfigured: true,
      toAddress: null,
      suppression: { reason: "Unsubscribed from this address", source: "contact record" },
      leadRepliedAt: null,
      sequence: {
        isActive: true,
        stopOnReply: true,
        stopOnUnsubscribe: true,
        sendWindowStart: 0,
        sendWindowEnd: 24,
        sendDays: [1, 2, 3, 4, 5, 6, 7],
        timezone: "Asia/Kolkata",
        dailyCap: 50,
      },
      enrollmentState: "active",
      sentToday: 0,
      unresolvedVariables: [],
      recentDuplicate: false,
      now: new Date(),
    });
    const codes = blockers.map((b) => b.code);
    expect(codes).toContain("unsubscribed");
    expect(codes).not.toContain("no_address");
  });
});

describe("a broken template is the sequence's fault, not the lead's", () => {
  it("holds rather than stopping every enrollment over one typo", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    // Written straight to the database, the way the seed does — the service
    // would have rejected the unknown variable on create.
    const sequence = await db.sequence.create({
      data: {
        workspaceId: workspace.id,
        name: "Broken template",
        isActive: true,
        stopOnReply: false,
        sendWindowStart: 0,
        sendWindowEnd: 24,
        sendDays: [1, 2, 3, 4, 5, 6, 7],
        steps: {
          create: [
            {
              workspaceId: workspace.id,
              stepOrder: 1,
              dayOffset: 0,
              channel: "EMAIL",
              subject: "Hello",
              bodyTemplate: "Hi {{first_name}},\n\n{{sender_frist_name}}",
            },
          ],
        },
      },
    });
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await advanceSequences(workspace.id);
    expect(result.queued).toBe(0);
    expect(result.held).toBe(1);
    expect(result.stopped).toBe(0);
    expect(Object.keys(result.refusals)).toContain("unknown_variables");

    // The enrollment survives, so fixing the step fixes everyone.
    const enrollment = await db.sequenceEnrollment.findFirstOrThrow({
      where: { sequenceId: sequence.id },
    });
    expect(enrollment.state).toBe("active");
    expect(enrollment.currentStep).toBe(0);
  });

  it("still stops a lead who is simply missing a value", async () => {
    withMailbox();
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await leadWithEmail(workspace.id, ctx.userId);
    const sequence = await db.sequence.create({
      data: {
        workspaceId: workspace.id,
        name: "Needs a signal",
        isActive: true,
        stopOnReply: false,
        sendWindowStart: 0,
        sendWindowEnd: 24,
        sendDays: [1, 2, 3, 4, 5, 6, 7],
        steps: {
          create: [
            {
              workspaceId: workspace.id,
              stepOrder: 1,
              dayOffset: 0,
              channel: "EMAIL",
              subject: "About {{signal}}",
              // A known variable this lead has no value for.
              bodyTemplate: "Hi {{first_name}}, I saw {{signal}}. Worth a call?",
            },
          ],
        },
      },
    });
    await db.sequenceEnrollment.create({
      data: {
        workspaceId: workspace.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        state: "active",
        nextSendAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await advanceSequences(workspace.id);
    expect(result.stopped).toBe(1);
    expect(result.held).toBe(0);
    const enrollment = await db.sequenceEnrollment.findFirstOrThrow({
      where: { sequenceId: sequence.id },
    });
    expect(enrollment.stopReason).toMatch(/\{\{signal\}\}/);
  });

  it("reports an unfillable variable on the sequence listing", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await db.sequence.create({
      data: {
        workspaceId: workspace.id,
        name: "Broken",
        steps: {
          create: [
            {
              workspaceId: workspace.id,
              stepOrder: 1,
              dayOffset: 0,
              channel: "EMAIL",
              subject: "Hi",
              bodyTemplate: "Hi {{first_name}} — {{sender_frist_name}}",
            },
          ],
        },
      },
    });

    const [listed] = await listSequences(ctx);
    expect(listed.steps[0].unknownVariables).toEqual(["sender_frist_name"]);
    // And the known one is still listed as usable.
    expect(listed.steps[0].variables).toContain("first_name");
  });

  it("accepts sender_first_name, which real sign-offs use", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createSequence(ctx, {
        ...SEQ,
        steps: [
          {
            ...SEQ.steps![0],
            bodyTemplate: "Hi {{first_name}}, worth a short call?\n\n{{sender_first_name}}",
          },
        ],
      })
    ).resolves.toBeDefined();
  });
});
