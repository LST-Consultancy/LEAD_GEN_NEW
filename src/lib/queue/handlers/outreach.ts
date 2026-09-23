import "server-only";
import { db } from "@/lib/db";
import { isEmailConfigured, activeEmailProvider } from "@/lib/outreach/provider";
import { sendEmail } from "@/lib/outreach/transport";
import { log } from "@/lib/observability/log";
import { render } from "@/lib/outreach/template";
import { resolveRecipient, suppressionLookup } from "@/lib/outreach/recipient";
import {
  checkSendable,
  nextSendWindow,
  localParts,
  dispositionOf,
  leadBlockers,
} from "@/lib/outreach/sendability";

/**
 * The outreach engine.
 *
 * Two handlers, split on purpose:
 *
 *  - `advanceSequences` decides *what should go out* and materialises a message
 *    row in QUEUED (or refuses, and records why).
 *  - `sendMessage` performs one delivery and re-checks sendability at the
 *    moment of sending.
 *
 * The re-check matters. Minutes pass between a message being queued and being
 * sent, and in that window the recipient may have replied or unsubscribed.
 * Checking only at queue time is how people receive a follow-up ten minutes
 * after answering.
 */

/** Resolves the template values for one lead, from rows that actually exist. */
type LeadForSend = {
  id: string;
  person: { fullName: string };
  company: { name: string; city: string | null; industry: string | null } | null;
  title: string | null;
  latestSignal: string | null;
};

function templateValues(
  lead: LeadForSend,
  sender: { name: string; company: string }
): Record<string, string | null> {
  const first = lead.person.fullName.trim().split(/\s+/)[0] ?? null;
  return {
    first_name: first,
    full_name: lead.person.fullName,
    company: lead.company?.name ?? null,
    title: lead.title,
    city: lead.company?.city ?? null,
    industry: lead.company?.industry ?? null,
    signal: lead.latestSignal,
    sender_name: sender.name,
    sender_first_name: sender.name.trim().split(/\s+/)[0] ?? null,
    sender_company: sender.company,
  };
}

/**
 * Sends one message.
 *
 * Idempotent by state: a message that is not QUEUED is left alone, so a
 * redelivered job cannot produce a second email. That check is the reason a
 * duplicate cannot happen, not the dedupe key on the enqueue.
 */
export async function sendMessage(workspaceId: string, messageId: string) {
  const message = await db.message.findFirst({
    where: { id: messageId, workspaceId, deletedAt: null },
    include: {
      conversation: {
        select: {
          id: true,
          leadId: true,
          lead: { select: { id: true, repliedAt: true } },
        },
      },
      sequenceStep: {
        select: {
          id: true,
          stepOrder: true,
          sequence: {
            select: {
              id: true,
              isActive: true,
              stopOnReply: true,
              stopOnUnsubscribe: true,
              sendWindowStart: true,
              sendWindowEnd: true,
              sendDays: true,
              timezone: true,
              dailyCap: true,
            },
          },
        },
      },
    },
  });

  if (!message) return { skipped: "message_missing" };
  if (message.state !== "QUEUED") {
    // Already sent, already failed, or pulled back to a draft.
    return { skipped: "not_queued", state: message.state };
  }

  const suppression = message.toAddress
    ? await db.suppression.findFirst({
        where: {
          workspaceId,
          OR: [
            { kind: "email", value: message.toAddress.toLowerCase() },
            { kind: "domain", value: message.toAddress.toLowerCase().split("@")[1] ?? "" },
          ],
        },
        select: { reason: true, source: true },
      })
    : null;

  const sequence = message.sequenceStep?.sequence;
  const now = new Date();

  // A one-off reply has no sequence, so the window and cap rules do not apply
  // to it — a person clicking reply has made the timing decision themselves.
  const { sendable, blockers } = checkSendable({
    providerConfigured: isEmailConfigured(),
    toAddress: message.toAddress,
    suppression,
    leadRepliedAt: message.conversation.lead?.repliedAt ?? null,
    sequence: sequence ?? {
      isActive: true,
      stopOnReply: false,
      stopOnUnsubscribe: true,
      sendWindowStart: 0,
      sendWindowEnd: 24,
      sendDays: [1, 2, 3, 4, 5, 6, 7],
      timezone: "Asia/Kolkata",
      dailyCap: Number.MAX_SAFE_INTEGER,
    },
    enrollmentState: "active",
    sentToday: sequence ? await sentTodayFor(workspaceId, sequence.id, sequence.timezone) : 0,
    unresolvedVariables: [],
    recentDuplicate: false,
    now,
  });

  if (!sendable) {
    const reason = blockers.map((b) => b.message).join(" ");
    const disposition = dispositionOf(blockers);
    // A wait keeps the message QUEUED so a later pass picks it up. Only a
    // lead-scoped blocker is a real, final failure.
    const keepQueued = disposition === "reschedule" || disposition === "hold";

    await db.message.update({
      where: { id: message.id },
      data: {
        state: keepQueued ? "QUEUED" : "FAILED",
        failureReason: reason,
      },
    });
    return {
      sent: false,
      blocked: blockers.map((b) => b.code),
      willRetry: keepQueued,
      disposition,
    };
  }

  // The rules ran and this message passed them. Now it is actually sent.
  const outcome = await sendEmail({
    from: {
      name: process.env.EMAIL_FROM_NAME || undefined,
      email: message.fromAddress ?? process.env.EMAIL_FROM ?? "",
    },
    // Non-null: `checkSendable` blocks on a missing address before here.
    to: { email: message.toAddress! },
    subject: message.subject ?? "",
    text: message.body,
    html: message.bodyHtml ?? undefined,
    headers: {
      // Lets a reply be tied back to this message without parsing the subject,
      // and gives bounce processing something stable to key on.
      "X-Signalroom-Message-Id": message.id,
    },
  });

  if (!outcome.ok) {
    // A retryable failure stays QUEUED so a later pass picks it up; a
    // permanent one does not, because retrying something a relay has already
    // refused is how a sender's reputation degrades.
    await db.message.update({
      where: { id: message.id },
      data: {
        state: outcome.retryable ? "QUEUED" : "FAILED",
        failureReason: outcome.reason,
        // A refused recipient is a fact about the address, not about this
        // message, so it is recorded where the next send will see it.
        ...(outcome.code === "rejected_recipient" ? { bouncedAt: new Date() } : {}),
      },
    });

    log.queue.warn("send failed", {
      messageId: message.id,
      code: outcome.code,
      retryable: outcome.retryable,
      adapter: outcome.adapter,
    });

    return {
      sent: false,
      blocked: [outcome.code],
      willRetry: outcome.retryable,
      disposition: outcome.retryable ? ("reschedule" as const) : ("stop" as const),
    };
  }

  await db.message.update({
    where: { id: message.id },
    data: {
      state: "SENT",
      sentAt: new Date(),
      // The provider's own id, which is what a bounce or a delivery receipt
      // will reference.
      externalId: outcome.providerMessageId,
      failureReason: null,
    },
  });

  // The lead has now been contacted, which the next scoring run and every
  // "went quiet" rule read.
  if (message.conversation.leadId) {
    await db.lead.update({
      where: { id: message.conversation.leadId },
      data: { lastContactedAt: new Date(), lastActivityAt: new Date() },
    });
  }

  log.queue.info("sent", {
    messageId: message.id,
    adapter: outcome.adapter,
    providerMessageId: outcome.providerMessageId,
  });

  return { sent: true, blocked: [], willRetry: false, disposition: "send" as const };
}

/** Sends made by one sequence since local midnight in its own timezone. */
async function sentTodayFor(workspaceId: string, sequenceId: string, timezone: string) {
  const now = new Date();
  const { hour, minute } = localParts(now, timezone);
  const since = new Date(now.getTime() - (hour * 60 + minute) * 60_000);

  return db.message.count({
    where: {
      workspaceId,
      sentAt: { gte: since },
      state: { in: ["SENT", "DELIVERED", "READ", "REPLIED"] },
      sequenceStep: { sequenceId },
    },
  });
}

/**
 * Advances every enrollment whose next step is due.
 *
 * Idempotent through `nextSendAt`: the row is only picked up when that time has
 * passed, and advancing always moves it forward. A redelivered job therefore
 * finds nothing due.
 */
export async function advanceSequences(workspaceId: string) {
  const now = new Date();

  const due = await db.sequenceEnrollment.findMany({
    where: {
      workspaceId,
      state: "active",
      nextSendAt: { lte: now },
      sequence: { isActive: true, deletedAt: null },
    },
    include: {
      sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } },
      lead: {
        select: {
          id: true,
          ownerId: true,
          repliedAt: true,
          person: {
            select: {
              fullName: true,
              employments: { where: { isCurrent: true }, select: { title: true }, take: 1 },
              contactMethods: {
                // `value` is null while a contact is locked, and `optedOutAt`
                // is a per-address opt-out separate from the workspace
                // suppression list. Both have to be respected here.
                where: {
                  kind: { in: ["WORK_EMAIL", "PERSONAL_EMAIL"] },
                  isLocked: false,
                  value: { not: null },
                },
                orderBy: { confidence: "desc" },
                select: { value: true, optedOutAt: true, bounceCount: true },
                take: 5,
              },
            },
          },
          company: { select: { name: true, city: true, industry: true } },
          signals: {
            orderBy: { detectedAt: "desc" },
            take: 1,
            select: { title: true },
          },
          owner: { select: { name: true } },
        },
      },
    },
    // Oldest-due first, and ordered explicitly. Without an `orderBy` the 200
    // rows Postgres returns are arbitrary, and because a `hold` deliberately
    // leaves `nextSendAt` in the past, held rows are re-read on every pass —
    // so an unordered batch could keep returning the same held enrollments and
    // starve newer ones indefinitely.
    orderBy: { nextSendAt: "asc" },
    take: 200,
  });

  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true },
  });

  // One read for the whole pass rather than two queries per lead.
  const lookup = suppressionLookup(
    await db.suppression.findMany({
      where: { workspaceId },
      select: { kind: true, value: true, reason: true, source: true },
    })
  );

  let queued = 0;
  let stopped = 0;
  let rescheduled = 0;
  let held = 0;
  let completed = 0;
  const refusals: Record<string, number> = {};

  for (const enrollment of due) {
    const steps = enrollment.sequence.steps;
    const step = steps.find((s) => s.stepOrder === enrollment.currentStep + 1);

    if (!step) {
      await db.sequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { state: "completed", completedAt: now, nextSendAt: null },
      });
      completed += 1;
      continue;
    }

    const lead = enrollment.lead;
    const values = templateValues(
      {
        id: lead.id,
        person: { fullName: lead.person.fullName },
        company: lead.company,
        title: lead.person.employments[0]?.title ?? null,
        latestSignal: lead.signals[0]?.title ?? null,
      },
      { name: lead.owner?.name ?? "the team", company: workspace.name }
    );

    const bodyRender = render(step.bodyTemplate, values);
    const subjectRender = render(step.subject ?? "", values);
    // Kept apart: a missing value is this lead's gap, an unknown variable is
    // the template's fault.
    const unresolved = [
      ...new Set([
        ...(bodyRender.ok ? [] : bodyRender.missing),
        ...(subjectRender.ok ? [] : subjectRender.missing),
      ]),
    ];
    const unknown = [
      ...new Set([
        ...(bodyRender.ok ? [] : bodyRender.unknown),
        ...(subjectRender.ok ? [] : subjectRender.unknown),
      ]),
    ];

    const { toAddress, suppression } = resolveRecipient(
      lead.person.contactMethods,
      { listed: lookup }
    );

    const { sendable, blockers } = checkSendable({
      providerConfigured: isEmailConfigured(),
      toAddress,
      suppression,
      leadRepliedAt: lead.repliedAt,
      sequence: enrollment.sequence,
      enrollmentState: enrollment.state,
      sentToday: await sentTodayFor(workspaceId, enrollment.sequenceId, enrollment.sequence.timezone),
      unresolvedVariables: unresolved,
      unknownVariables: unknown,
      recentDuplicate: false,
      now,
    });

    for (const b of blockers) refusals[b.code] = (refusals[b.code] ?? 0) + 1;

    if (!sendable) {
      const disposition = dispositionOf(blockers);

      if (disposition === "reschedule") {
        // The clock will clear it. Try again when the window opens, without
        // consuming the step.
        await db.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { nextSendAt: nextSendWindow(now, enrollment.sequence) },
        });
        rescheduled += 1;
      } else if (disposition === "hold") {
        // Waiting on an admin (no provider) or on whoever paused the sequence.
        // Leave the enrollment untouched: stopping it would mean re-enrolling
        // everyone once the mailbox is connected.
        held += 1;
      } else {
        await db.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            state: "stopped",
            stopReason: leadBlockers(blockers)
              .map((b) => b.message)
              .join(" "),
            nextSendAt: null,
            ...(lead.repliedAt ? { repliedAt: lead.repliedAt } : {}),
          },
        });
        stopped += 1;
      }
      continue;
    }

    // A manual step is a task for a human, not an email.
    if (step.isManualTask) {
      await db.task.create({
        data: {
          workspaceId,
          title:
            subjectRender.text ||
            `Step ${step.stepOrder}: follow up with ${lead.person.fullName}`,
          description: bodyRender.text,
          leadId: lead.id,
          ownerId: lead.ownerId,
          channel: step.channel,
          dueAt: now,
          priority: "MEDIUM",
          priorityReason: `Step ${step.stepOrder} of "${enrollment.sequence.name}" is a manual step, so it is a task rather than an email.`,
          recommendedAction: bodyRender.text.slice(0, 280),
        },
      });
    } else {
      const conversation = await db.conversation.upsert({
        where: { id: await conversationIdFor(workspaceId, lead.id, step.channel) },
        create: {
          workspaceId,
          channel: step.channel,
          subject: subjectRender.text || null,
          state: "WAITING",
          leadId: lead.id,
          assigneeId: lead.ownerId,
        },
        update: { lastMessageAt: now, state: "WAITING" },
      });

      await db.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          channel: step.channel,
          state: "QUEUED",
          toAddress,
          subject: subjectRender.text || null,
          body: bodyRender.text,
          actorType: "SYSTEM",
          sequenceStepId: step.id,
        },
      });
      queued += 1;
    }

    const isLast = step.stepOrder >= Math.max(...steps.map((s) => s.stepOrder));
    const nextStep = steps.find((s) => s.stepOrder === step.stepOrder + 1);

    await db.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        currentStep: step.stepOrder,
        ...(isLast || !nextStep
          ? { state: "completed", completedAt: now, nextSendAt: null }
          : {
              nextSendAt: nextSendWindow(
                new Date(
                  enrollment.enrolledAt.getTime() + nextStep.dayOffset * 86_400_000
                ),
                enrollment.sequence
              ),
            }),
      },
    });
    if (isLast || !nextStep) completed += 1;
  }

  return {
    considered: due.length,
    queued,
    stopped,
    rescheduled,
    /** Waiting on configuration, not on the clock and not on the lead. */
    held,
    completed,
    refusals,
    provider: activeEmailProvider(),
  };
}

/**
 * Finds the open thread for this lead on this channel, or a fresh uuid so the
 * upsert creates one. Keeping a sequence's steps in one thread is what makes
 * the Inbox read like a conversation rather than a list of sends.
 */
async function conversationIdFor(workspaceId: string, leadId: string, channel: string) {
  const existing = await db.conversation.findFirst({
    where: {
      workspaceId,
      leadId,
      channel: channel as never,
      deletedAt: null,
      state: { notIn: ["CLOSED"] },
    },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });
  return existing?.id ?? crypto.randomUUID();
}

/**
 * Returns snoozed conversations to the inbox once their time has passed.
 * Idempotent: it only touches rows whose snooze is already in the past, and
 * clears the timestamp as it goes.
 */
export async function wakeSnoozedConversations(workspaceId: string) {
  const now = new Date();
  const woken = await db.conversation.updateMany({
    where: {
      workspaceId,
      state: "SNOOZED",
      snoozedUntil: { lte: now },
      deletedAt: null,
    },
    data: { state: "NEEDS_YOU", snoozedUntil: null, isUnread: true },
  });
  return { woken: woken.count };
}
