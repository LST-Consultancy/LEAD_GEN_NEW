import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate, touchLead } from "@/lib/services/mutate";
import { isEmailConfigured, activeEmailProvider, EMAIL_NOT_CONFIGURED } from "@/lib/outreach/provider";
import { reviewCopy } from "@/lib/outreach/template";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";
import { visibilityWhereForConversation } from "@/lib/services/inbox-scope";

const replySchema = z.object({
  body: z.string().trim().min(1, "A reply needs a body.").max(20_000),
  subject: z.string().trim().max(300).optional(),
});

/**
 * Composing a reply.
 *
 * With no provider connected this does **not** pretend to send. The reply is
 * stored as a DRAFT and the result says so, because losing what someone typed
 * would be worse than either sending or refusing — and claiming it was sent
 * would be a lie the user only discovers when nobody answers (§126).
 */
export async function replyToConversation(
  ctx: AuthContext,
  conversationId: string,
  raw: z.input<typeof replySchema>
) {
  const input = replySchema.parse(raw);

  const conversation = await loadScoped(
    () =>
      db.conversation.findFirst({
        where: {
          id: conversationId,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...visibilityWhereForConversation(ctx),
        },
        include: {
          lead: { select: { id: true, person: { select: { fullName: true } } } },
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { fromAddress: true, toAddress: true, direction: true, subject: true },
          },
        },
      }),
    "That conversation"
  );

  // Reply to whoever wrote last; on an outbound-only thread, keep the same
  // recipient.
  const last = conversation.messages[0];
  const toAddress =
    last?.direction === "INBOUND" ? last.fromAddress : (last?.toAddress ?? null);

  if (!toAddress) {
    throw new MutationError(
      "This thread has no address to reply to. It was recorded without one, so a reply has to be sent from your own mail client.",
      "no_address",
      422
    );
  }

  const configured = isEmailConfigured();
  const subject =
    input.subject ??
    conversation.subject ??
    (last?.subject ? `Re: ${last.subject.replace(/^re:\s*/i, "")}` : "Re:");

  return mutate(ctx, PERMISSIONS.OUTREACH_SEND, async () => {
    const message = await db.message.create({
      data: {
        workspaceId: ctx.workspaceId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: conversation.channel,
        // The state is the truth about what happened: QUEUED means a worker
        // will pick it up, DRAFT means nothing will.
        state: configured ? "QUEUED" : "DRAFT",
        fromAddress: ctx.user.email,
        toAddress,
        subject,
        body: input.body,
        actorType: "HUMAN",
        actorUserId: ctx.userId,
      },
    });

    if (configured) {
      // Marked as waiting on them, since we just wrote.
      await db.conversation.update({
        where: { id: conversation.id },
        data: { state: "WAITING", isUnread: false, lastMessageAt: new Date() },
      });
      if (conversation.leadId) await touchLead(conversation.leadId);
      // The dedupe key only collapses a double click. Correctness comes from
      // the handler refusing to send a message that is not QUEUED, because a
      // duplicate landing in someone's mailbox cannot be undone.
      await enqueue(
        JOB.SEND_MESSAGE,
        { messageId: message.id },
        { dedupeKey: `send-${message.id}`, dedupeWindowSec: 60 }
      );
    }

    return {
      result: {
        message: toPlain(message),
        sent: configured,
        provider: activeEmailProvider(),
        // The sentence the UI shows. It has to match what actually happened.
        note: configured
          ? "Queued for sending. It will appear as sent once the provider confirms."
          : `Saved as a draft on this thread. ${EMAIL_NOT_CONFIGURED}`,
        copyWarnings: reviewCopy(subject, input.body),
      },
      log: {
        action: configured ? "message.queued" : "message.drafted",
        objectType: "Message",
        objectId: message.id,
        after: { conversationId: conversation.id, toAddress, state: message.state },
        activity: conversation.leadId
          ? {
              kind: configured ? "outreach.replied" : "outreach.drafted",
              summary: configured
                ? `Replied to ${conversation.lead?.person.fullName ?? "a thread"}`
                : `Drafted a reply to ${conversation.lead?.person.fullName ?? "a thread"} (not sent — no mailbox connected)`,
              leadId: conversation.leadId,
            }
          : undefined,
      },
    };
  });
}

const stateSchema = z.object({
  state: z.enum(["OPEN", "NEEDS_YOU", "WAITING", "SNOOZED", "CLOSED"]),
  snoozedUntil: z.coerce.date().optional(),
});

export async function setConversationState(
  ctx: AuthContext,
  conversationId: string,
  raw: z.input<typeof stateSchema>
) {
  const input = stateSchema.parse(raw);

  if (input.state === "SNOOZED") {
    if (!input.snoozedUntil) {
      throw new MutationError(
        "Snoozing needs a date to come back on, otherwise the thread would just disappear.",
        "snooze_needs_date",
        422
      );
    }
    if (input.snoozedUntil.getTime() <= Date.now()) {
      throw new MutationError(
        "That snooze time has already passed, so the thread would reappear immediately.",
        "snooze_in_past",
        422
      );
    }
  }

  const conversation = await loadScoped(
    () =>
      db.conversation.findFirst({
        where: {
          id: conversationId,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...visibilityWhereForConversation(ctx),
        },
        select: { id: true, state: true, subject: true, leadId: true },
      }),
    "That conversation"
  );

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const updated = await db.conversation.update({
      where: { id: conversation.id },
      data: {
        state: input.state,
        // Leaving a snooze clears the wake-up time; keeping a stale one would
        // make the recycle of state unpredictable.
        snoozedUntil: input.state === "SNOOZED" ? input.snoozedUntil : null,
        isUnread: input.state === "CLOSED" ? false : undefined,
      },
    });

    return {
      result: toPlain(updated),
      log: {
        action: "conversation.state_changed",
        objectType: "Conversation",
        objectId: conversation.id,
        before: { state: conversation.state },
        after: { state: updated.state, snoozedUntil: updated.snoozedUntil },
      },
    };
  });
}

export async function setConversationRead(
  ctx: AuthContext,
  conversationId: string,
  isUnread: boolean
) {
  const conversation = await loadScoped(
    () =>
      db.conversation.findFirst({
        where: {
          id: conversationId,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...visibilityWhereForConversation(ctx),
        },
        select: { id: true, isUnread: true },
      }),
    "That conversation"
  );

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const updated = await db.conversation.update({
      where: { id: conversation.id },
      data: { isUnread },
    });
    return {
      result: toPlain(updated),
      log: {
        action: "conversation.read_changed",
        objectType: "Conversation",
        objectId: conversation.id,
        before: { isUnread: conversation.isUnread },
        after: { isUnread },
        // Marking read is not worth a team activity row.
      },
    };
  });
}

export async function assignConversation(
  ctx: AuthContext,
  conversationId: string,
  assigneeId: string | null
) {
  const conversation = await loadScoped(
    () =>
      db.conversation.findFirst({
        where: {
          id: conversationId,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...visibilityWhereForConversation(ctx),
        },
        select: { id: true, assigneeId: true, subject: true },
      }),
    "That conversation"
  );

  if (assigneeId) {
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId: ctx.workspaceId, userId: assigneeId, deletedAt: null },
      select: { userId: true, user: { select: { name: true } } },
    });
    if (!member) {
      throw new MutationError(
        "That person is not a member of this workspace.",
        "not_a_member",
        422
      );
    }
  }

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const updated = await db.conversation.update({
      where: { id: conversation.id },
      data: { assigneeId },
    });
    return {
      result: toPlain(updated),
      log: {
        action: "conversation.assigned",
        objectType: "Conversation",
        objectId: conversation.id,
        before: { assigneeId: conversation.assigneeId },
        after: { assigneeId },
      },
    };
  });
}

const approveSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * §55 — the approval queue for AI-drafted outbound. Approving does not send by
 * itself; it moves the message to QUEUED and lets the worker apply the same
 * sendability rules the engine uses. With no provider, approval is refused
 * outright rather than parking the message in a queue that will never drain.
 */
export async function decideOnMessage(
  ctx: AuthContext,
  messageId: string,
  raw: z.input<typeof approveSchema>
) {
  const input = approveSchema.parse(raw);

  const message = await loadScoped(
    () =>
      db.message.findFirst({
        where: { id: messageId, workspaceId: ctx.workspaceId, deletedAt: null },
        include: {
          conversation: {
            select: { id: true, leadId: true, lead: { select: { person: { select: { fullName: true } } } } },
          },
        },
      }),
    "That message"
  );

  if (message.state !== "PENDING_APPROVAL") {
    throw new MutationError(
      `This message is ${message.state.toLowerCase().replace(/_/g, " ")}, not waiting for approval, so there is nothing to decide.`,
      "not_pending",
      409
    );
  }

  if (input.decision === "reject" && !input.reason) {
    throw new MutationError(
      "Rejecting needs a reason — it is the feedback the drafting improves on.",
      "reason_required",
      422
    );
  }

  const configured = isEmailConfigured();
  if (input.decision === "approve" && !configured) {
    throw new MutationError(
      `Approving would put this in a send queue that cannot drain. ${EMAIL_NOT_CONFIGURED}`,
      "no_provider",
      422
    );
  }

  return mutate(ctx, PERMISSIONS.OUTREACH_APPROVE, async () => {
    const updated = await db.message.update({
      where: { id: message.id },
      data: {
        state: input.decision === "approve" ? "QUEUED" : "DRAFT",
        failureReason: input.decision === "reject" ? `Rejected: ${input.reason}` : null,
      },
    });

    if (input.decision === "approve") {
      await enqueue(
        JOB.SEND_MESSAGE,
        { messageId: message.id },
        { dedupeKey: `send-${message.id}`, dedupeWindowSec: 60 }
      );
    }

    const who = message.conversation.lead?.person.fullName ?? "a contact";
    return {
      result: {
        message: toPlain(updated),
        note:
          input.decision === "approve"
            ? "Approved and queued. The send still has to pass the suppression and send-window checks."
            : "Rejected and returned to drafts. Nothing was sent.",
      },
      log: {
        action: input.decision === "approve" ? "message.approved" : "message.rejected",
        objectType: "Message",
        objectId: message.id,
        before: { state: message.state },
        after: { state: updated.state, reason: input.reason ?? null },
        activity: {
          kind: input.decision === "approve" ? "outreach.approved" : "outreach.rejected",
          summary:
            input.decision === "approve"
              ? `Approved an AI-drafted message to ${who}`
              : `Rejected an AI-drafted message to ${who}: ${input.reason}`,
          leadId: message.conversation.leadId ?? undefined,
        },
      },
    };
  });
}

const suppressSchema = z.object({
  value: z.string().trim().min(3).max(320),
  kind: z.enum(["email", "domain", "phone"]).default("email"),
  reason: z.string().trim().min(3, "Record why, so the entry can be justified later.").max(300),
});

/**
 * §104 — adding to the do-not-contact registry. This is the one write in the
 * app with no undo offered in the UI: removing a suppression is possible, but
 * it is deliberately not one click away from the thread where someone asked to
 * be left alone.
 */
export async function suppressAddress(ctx: AuthContext, raw: z.input<typeof suppressSchema>) {
  const input = suppressSchema.parse(raw);

  if (input.kind === "email" && !input.value.includes("@")) {
    throw new MutationError(
      "That does not look like an email address. Use the domain kind to suppress a whole company.",
      "bad_address",
      422
    );
  }

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const value = input.value.toLowerCase();
    const entry = await db.suppression.upsert({
      where: {
        workspaceId_kind_value: { workspaceId: ctx.workspaceId, kind: input.kind, value },
      },
      create: {
        workspaceId: ctx.workspaceId,
        kind: input.kind,
        value,
        reason: input.reason,
        source: "manual",
      },
      update: { reason: input.reason, source: "manual" },
    });

    // Stop every live enrollment that would have written to this address.
    const stopped = await db.sequenceEnrollment.updateMany({
      where: {
        workspaceId: ctx.workspaceId,
        state: "active",
        lead: {
          person: {
            contactMethods: {
              some: {
                workspaceId: ctx.workspaceId,
                value: input.kind === "email" ? value : { endsWith: value },
              },
            },
          },
        },
      },
      data: { state: "stopped", stopReason: `Suppressed: ${input.reason}`, nextSendAt: null },
    });

    return {
      result: {
        suppression: toPlain(entry),
        enrollmentsStopped: stopped.count,
        note:
          stopped.count > 0
            ? `Added to the do-not-contact list, and ${stopped.count} live sequence ${stopped.count === 1 ? "enrollment" : "enrollments"} stopped.`
            : "Added to the do-not-contact list. No live sequences were writing to it.",
      },
      log: {
        action: "suppression.added",
        objectType: "Suppression",
        objectId: entry.id,
        after: { kind: input.kind, value, reason: input.reason, enrollmentsStopped: stopped.count },
        activity: {
          kind: "suppression.added",
          summary: `${value} added to do-not-contact — ${input.reason}`,
        },
      },
    };
  });
}
