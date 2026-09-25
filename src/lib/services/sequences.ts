import "server-only";
import { sendingReady } from "./mailbox-sending";
import { readsReplies } from "./mailboxes";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate } from "@/lib/services/mutate";
import {
  activeEmailProvider,
  EMAIL_NOT_CONFIGURED,
  REPLIES_NOT_READABLE,
} from "@/lib/outreach/provider";
import { render, reviewCopy, variablesIn } from "@/lib/outreach/template";
import { resolveRecipient, suppressionLookup } from "@/lib/outreach/recipient";
import {
  checkSendable,
  nextSendWindow,
  leadBlockers,
  DAY_NAME,
} from "@/lib/outreach/sendability";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";

const stepSchema = z.object({
  stepOrder: z.number().int().min(1).max(20),
  dayOffset: z.number().int().min(0).max(365),
  channel: z.enum(["EMAIL", "WHATSAPP", "LINKEDIN", "PHONE", "SMS", "IN_PERSON"]),
  isManualTask: z.boolean().default(false),
  subject: z.string().trim().max(300).optional(),
  bodyTemplate: z.string().trim().min(1, "A step needs a body.").max(20_000),
});

const sequenceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  stopOnReply: z.boolean().default(true),
  stopOnUnsubscribe: z.boolean().default(true),
  sendWindowStart: z.number().int().min(0).max(23).default(9),
  sendWindowEnd: z.number().int().min(1).max(24).default(19),
  sendDays: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one sending day.").default([1, 2, 3, 4, 5]),
  timezone: z.string().trim().min(1).default("Asia/Kolkata"),
  dailyCap: z.number().int().min(1).max(2000).default(50),
  steps: z.array(stepSchema).min(1, "A sequence needs at least one step.").max(20),
});

export type SequenceInput = z.input<typeof sequenceSchema>;

function validateShape(input: z.output<typeof sequenceSchema>) {
  if (input.sendWindowEnd <= input.sendWindowStart) {
    throw new MutationError(
      `The send window closes at ${input.sendWindowEnd}:00, which is not after it opens at ${input.sendWindowStart}:00 — nothing would ever send.`,
      "bad_window",
      422
    );
  }

  const orders = input.steps.map((s) => s.stepOrder);
  if (new Set(orders).size !== orders.length) {
    throw new MutationError("Two steps share the same position.", "duplicate_step", 422);
  }

  const sorted = [...input.steps].sort((a, b) => a.stepOrder - b.stepOrder);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].dayOffset < sorted[i - 1].dayOffset) {
      throw new MutationError(
        `Step ${sorted[i].stepOrder} is scheduled for day ${sorted[i].dayOffset}, before step ${sorted[i - 1].stepOrder} on day ${sorted[i - 1].dayOffset}. Steps have to move forward in time.`,
        "steps_out_of_order",
        422
      );
    }
    if (sorted[i].dayOffset === sorted[i - 1].dayOffset && !sorted[i].isManualTask) {
      throw new MutationError(
        `Steps ${sorted[i - 1].stepOrder} and ${sorted[i].stepOrder} both land on day ${sorted[i].dayOffset}. Two emails on the same day to the same person reads as a mistake.`,
        "same_day_steps",
        422
      );
    }
  }

  // An unknown variable would reach the recipient as literal braces.
  for (const step of input.steps) {
    const unknown = [
      ...variablesIn(step.bodyTemplate).unknown,
      ...variablesIn(step.subject ?? "").unknown,
    ];
    if (unknown.length > 0) {
      throw new MutationError(
        `Step ${step.stepOrder} uses ${unknown.map((u) => `{{${u}}}`).join(", ")}, which is not a variable this app can fill. The recipient would see the braces.`,
        "unknown_variable",
        422
      );
    }
    if (!step.isManualTask && step.channel === "EMAIL" && !step.subject) {
      throw new MutationError(
        `Step ${step.stepOrder} is an email with no subject line.`,
        "no_subject",
        422
      );
    }
    // Only email has a sending path. An automatic WhatsApp or LinkedIn step
    // would be queued as a message to the lead's email address.
    if (!step.isManualTask && step.channel !== "EMAIL") {
      throw new MutationError(
        `Step ${step.stepOrder} is ${step.channel.toLowerCase().replace("_", " ")}, which this app cannot send automatically. Make it a manual task — it becomes a task for the lead's owner on that day.`,
        "channel_not_automatic",
        422
      );
    }
  }
}

export async function listSequences(ctx: AuthContext) {
  const sequences = await db.sequence.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    include: {
      steps: { orderBy: { stepOrder: "asc" } },
      _count: { select: { enrollments: true } },
    },
  });

  const ids = sequences.map((s) => s.id);
  const [enrollmentStates, repliedBySequence] = await Promise.all([
    db.sequenceEnrollment.groupBy({
      by: ["sequenceId", "state"],
      where: { workspaceId: ctx.workspaceId, sequenceId: { in: ids } },
      _count: { _all: true },
    }),
    // Grouped by sequence. A single workspace-wide count was being rendered
    // against every row, so two sequences both showed the combined total.
    //
    // The condition looks at the *lead*, not at `SequenceEnrollment.repliedAt`.
    // The enrollment field is only written when the engine stops someone for
    // replying, so it under-reports every reply that arrived before the engine
    // next ran — and reports nothing at all until it has run once.
    db.sequenceEnrollment.groupBy({
      by: ["sequenceId"],
      where: {
        workspaceId: ctx.workspaceId,
        sequenceId: { in: ids },
        OR: [{ repliedAt: { not: null } }, { lead: { repliedAt: { not: null } } }],
      },
      _count: { _all: true },
    }),
  ]);

  return sequences.map((s) => {
    const states = enrollmentStates.filter((e) => e.sequenceId === s.id);
    const count = (state: string) =>
      states.find((e) => e.state === state)?._count._all ?? 0;

    const active = count("active");
    const total = s._count.enrollments;
    const replied = repliedBySequence.find((r) => r.sequenceId === s.id)?._count._all ?? 0;

    return {
      ...toPlain({
        id: s.id,
        name: s.name,
        description: s.description,
        isActive: s.isActive,
        senderMailboxId: s.senderMailboxId,
        stopOnReply: s.stopOnReply,
        stopOnUnsubscribe: s.stopOnUnsubscribe,
        sendWindowStart: s.sendWindowStart,
        sendWindowEnd: s.sendWindowEnd,
        sendDays: s.sendDays,
        timezone: s.timezone,
        dailyCap: s.dailyCap,
        createdAt: s.createdAt,
      }),
      steps: s.steps.map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        dayOffset: step.dayOffset,
        channel: step.channel,
        isManualTask: step.isManualTask,
        subject: step.subject,
        bodyTemplate: step.bodyTemplate,
        variables: variablesIn(step.bodyTemplate).known,
        /**
         * Variables no lead can fill. Surfaced separately from copy warnings
         * because this one is not advisory — every recipient would see the
         * braces. A step created through this app cannot have any, but a step
         * written directly into the database can, so the screen has to say so.
         */
        unknownVariables: [
          ...new Set([
            ...variablesIn(step.bodyTemplate).unknown,
            ...variablesIn(step.subject ?? "").unknown,
          ]),
        ],
        copyWarnings: step.isManualTask
          ? []
          : reviewCopy(step.subject ?? "", step.bodyTemplate),
      })),
      stats: {
        enrolled: total,
        active,
        completed: count("completed"),
        stopped: count("stopped"),
        paused: count("paused"),
        replied,
        // Never a rate over nothing.
        replyRate: total > 0 ? Math.round((replied / total) * 100) : null,
      },
      schedule: describeSchedule(s),
    };
  });
}

function describeSchedule(s: {
  sendDays: number[];
  sendWindowStart: number;
  sendWindowEnd: number;
  timezone: string;
  dailyCap: number;
}) {
  const days = [...s.sendDays].sort((a, b) => a - b);
  const weekdaysOnly = days.length === 5 && days.every((d) => d <= 5);
  const label = weekdaysOnly
    ? "weekdays"
    : days.map((d) => DAY_NAME[d].slice(0, 3)).join(", ");
  return `${label}, ${String(s.sendWindowStart).padStart(2, "0")}:00–${String(s.sendWindowEnd).padStart(2, "0")}:00 ${s.timezone}, up to ${s.dailyCap} a day`;
}

export async function createSequence(ctx: AuthContext, raw: SequenceInput) {
  const input = sequenceSchema.parse(raw);
  validateShape(input);

  const clash = await db.sequence.findFirst({
    where: { workspaceId: ctx.workspaceId, name: input.name, deletedAt: null },
    select: { id: true },
  });
  if (clash) {
    throw new MutationError("A sequence with that name already exists.", "duplicate_name", 409);
  }

  return mutate(ctx, PERMISSIONS.OUTREACH_SEND, async () => {
    const sequence = await db.sequence.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        description: input.description,
        // New sequences start paused. Creating one and having it begin
        // emailing immediately is not a mistake a user should be able to make.
        isActive: false,
        stopOnReply: input.stopOnReply,
        stopOnUnsubscribe: input.stopOnUnsubscribe,
        sendWindowStart: input.sendWindowStart,
        sendWindowEnd: input.sendWindowEnd,
        sendDays: input.sendDays,
        timezone: input.timezone,
        dailyCap: input.dailyCap,
        createdById: ctx.userId,
        steps: {
          create: input.steps.map((s) => ({
            workspaceId: ctx.workspaceId,
            stepOrder: s.stepOrder,
            dayOffset: s.dayOffset,
            channel: s.channel,
            isManualTask: s.isManualTask,
            subject: s.subject,
            bodyTemplate: s.bodyTemplate,
          })),
        },
      },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });

    return {
      result: {
        sequence: toPlain(sequence),
        note: "Created, and left paused. Nothing sends until you activate it.",
      },
      log: {
        action: "sequence.created",
        objectType: "Sequence",
        objectId: sequence.id,
        after: { name: input.name, steps: input.steps.length },
        activity: {
          kind: "sequence.created",
          summary: `Created the sequence "${input.name}" with ${input.steps.length} ${input.steps.length === 1 ? "step" : "steps"}`,
        },
      },
    };
  });
}

export async function updateSequence(ctx: AuthContext, id: string, raw: SequenceInput) {
  const input = sequenceSchema.parse(raw);
  validateShape(input);

  const existing = await loadScoped(
    () =>
      db.sequence.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
        include: { steps: true, _count: { select: { enrollments: true } } },
      }),
    "That sequence"
  );

  const live = await db.sequenceEnrollment.count({
    where: { workspaceId: ctx.workspaceId, sequenceId: id, state: "active" },
  });

  return mutate(ctx, PERMISSIONS.OUTREACH_SEND, async () => {
    // Steps are replaced rather than diffed. Messages reference a step by id,
    // so the old rows have to stay — deleting them would orphan sent history.
    // Instead they are superseded: the sequence points at the new set.
    const sequence = await db.$transaction(async (tx) => {
      const keepIds = new Set(input.steps.map((s) => s.stepOrder));
      await tx.sequenceStep.deleteMany({
        where: {
          sequenceId: id,
          stepOrder: { notIn: [...keepIds] },
          // Only steps that never sent anything can be removed outright.
          messages: { none: {} },
        },
      });

      for (const s of input.steps) {
        await tx.sequenceStep.upsert({
          where: { sequenceId_stepOrder: { sequenceId: id, stepOrder: s.stepOrder } },
          create: {
            workspaceId: ctx.workspaceId,
            sequenceId: id,
            stepOrder: s.stepOrder,
            dayOffset: s.dayOffset,
            channel: s.channel,
            isManualTask: s.isManualTask,
            subject: s.subject,
            bodyTemplate: s.bodyTemplate,
          },
          update: {
            dayOffset: s.dayOffset,
            channel: s.channel,
            isManualTask: s.isManualTask,
            subject: s.subject,
            bodyTemplate: s.bodyTemplate,
          },
        });
      }

      return tx.sequence.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          stopOnReply: input.stopOnReply,
          stopOnUnsubscribe: input.stopOnUnsubscribe,
          sendWindowStart: input.sendWindowStart,
          sendWindowEnd: input.sendWindowEnd,
          sendDays: input.sendDays,
          timezone: input.timezone,
          dailyCap: input.dailyCap,
        },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      });
    });

    return {
      result: {
        sequence: toPlain(sequence),
        note:
          live > 0
            ? `Saved. ${live} ${live === 1 ? "lead is" : "leads are"} part-way through this sequence and will receive the edited copy for their remaining steps.`
            : "Saved. No one is mid-sequence, so this takes effect for everyone enrolled from now on.",
      },
      log: {
        action: "sequence.updated",
        objectType: "Sequence",
        objectId: id,
        before: { name: existing.name, steps: existing.steps.length },
        after: { name: input.name, steps: input.steps.length, liveEnrollments: live },
      },
    };
  });
}

/**
 * Activating is the moment a sequence can start sending, so it is the right
 * place to refuse when the provider cannot support the promises the sequence
 * makes — in particular stop-on-reply, which needs a mailbox that can read.
 */
export async function setSequenceActive(ctx: AuthContext, id: string, isActive: boolean) {
  const sequence = await loadScoped(
    () =>
      db.sequence.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
        include: { steps: true },
      }),
    "That sequence"
  );

  if (isActive) {
    if (sequence.steps.length === 0) {
      throw new MutationError(
        "This sequence has no steps, so activating it would do nothing.",
        "no_steps",
        422
      );
    }
    if (!(await sendingReady(ctx.workspaceId))) {
      throw new MutationError(EMAIL_NOT_CONFIGURED, "no_provider", 422);
    }
    if (sequence.stopOnReply && !(await readsReplies(ctx.workspaceId))) {
      throw new MutationError(REPLIES_NOT_READABLE, "cannot_read_replies", 422);
    }
  }

  return mutate(ctx, PERMISSIONS.OUTREACH_SEND, async () => {
    const updated = await db.sequence.update({
      where: { id },
      data: { isActive },
    });

    // Pausing must also stop the clock on everyone mid-sequence, or resuming
    // would fire every missed step at once.
    let touched = 0;
    if (!isActive) {
      const paused = await db.sequenceEnrollment.updateMany({
        where: { workspaceId: ctx.workspaceId, sequenceId: id, state: "active" },
        data: { state: "paused", pausedAt: new Date(), nextSendAt: null },
      });
      touched = paused.count;
    } else {
      const resumed = await db.sequenceEnrollment.findMany({
        where: { workspaceId: ctx.workspaceId, sequenceId: id, state: "paused" },
        select: { id: true },
      });
      for (const e of resumed) {
        await db.sequenceEnrollment.update({
          where: { id: e.id },
          data: {
            state: "active",
            pausedAt: null,
            // Resume from now, not from the original schedule, so a week of
            // missed steps does not arrive in one batch.
            nextSendAt: nextSendWindow(new Date(), updated),
          },
        });
      }
      touched = resumed.length;
      await enqueue(
        JOB.ADVANCE_SEQUENCES,
        { workspaceId: ctx.workspaceId },
        { dedupeKey: `advance-${ctx.workspaceId}`, dedupeWindowSec: 30 }
      );
    }

    return {
      result: {
        sequence: toPlain(updated),
        note: isActive
          ? touched > 0
            ? `Active. ${touched} paused ${touched === 1 ? "enrollment resumes" : "enrollments resume"} from the next send window rather than firing their missed steps at once.`
            : "Active. New enrollments will begin sending in the next window."
          : touched > 0
            ? `Paused, and ${touched} live ${touched === 1 ? "enrollment was" : "enrollments were"} paused with it. Nothing further will send.`
            : "Paused. Nothing further will send.",
      },
      log: {
        action: isActive ? "sequence.activated" : "sequence.paused",
        objectType: "Sequence",
        objectId: id,
        before: { isActive: sequence.isActive },
        after: { isActive, enrollmentsTouched: touched },
        activity: {
          kind: isActive ? "sequence.activated" : "sequence.paused",
          summary: `${isActive ? "Activated" : "Paused"} the sequence "${sequence.name}"`,
        },
      },
    };
  });
}

const enrollSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1, "Pick at least one lead.").max(500),
});

/**
 * Enrolling leads.
 *
 * This runs the same sendability check the engine will run, per lead, and
 * reports which leads were *not* enrolled and why. Enrolling a lead that can
 * never be sent to would leave it sitting in "active" forever, looking like
 * progress.
 */
export async function enrollLeads(
  ctx: AuthContext,
  sequenceId: string,
  raw: z.input<typeof enrollSchema>
) {
  const input = enrollSchema.parse(raw);

  const sequence = await loadScoped(
    () =>
      db.sequence.findFirst({
        where: { id: sequenceId, workspaceId: ctx.workspaceId, deletedAt: null },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      }),
    "That sequence"
  );

  if (sequence.steps.length === 0) {
    throw new MutationError("This sequence has no steps to send.", "no_steps", 422);
  }
  if (sequence.stopOnReply && !(await readsReplies(ctx.workspaceId))) {
    throw new MutationError(REPLIES_NOT_READABLE, "cannot_read_replies", 422);
  }

  // Visibility applies: a rep cannot enroll a lead they cannot see.
  const leads = await db.lead.findMany({
    where: {
      id: { in: input.leadIds },
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      archivedAt: null,
      ...leadVisibilityFilter(ctx),
    },
    select: {
      id: true,
      repliedAt: true,
      person: {
        select: {
          fullName: true,
          contactMethods: {
            where: {
              kind: { in: ["WORK_EMAIL", "PERSONAL_EMAIL"] },
              isLocked: false,
              value: { not: null },
            },
            select: { value: true, optedOutAt: true, bounceCount: true },
          },
        },
      },
      enrollments: { where: { sequenceId }, select: { id: true, state: true } },
    },
  });

  const lookup = suppressionLookup(
    await db.suppression.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { kind: true, value: true, reason: true, source: true },
    })
  );

  const enrollable: string[] = [];
  const skipped: { leadId: string; name: string; reason: string }[] = [];
  const now = new Date();
  const ready = await sendingReady(ctx.workspaceId);

  for (const leadId of input.leadIds) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) {
      skipped.push({
        leadId,
        name: "Unknown lead",
        reason: "That lead doesn't exist, is archived, or you don't have access to it.",
      });
      continue;
    }
    if (lead.enrollments.length > 0) {
      skipped.push({
        leadId,
        name: lead.person.fullName,
        reason: `Already ${lead.enrollments[0].state} in this sequence.`,
      });
      continue;
    }

    const { toAddress, suppression } = resolveRecipient(lead.person.contactMethods, {
      listed: lookup,
    });

    const { sendable, blockers } = checkSendable({
      providerConfigured: ready,
      toAddress,
      suppression,
      leadRepliedAt: lead.repliedAt,
      sequence,
      enrollmentState: "active",
      sentToday: 0,
      unresolvedVariables: [],
      recentDuplicate: false,
      now,
    });

    // Only lead-scoped blockers refuse a lead. A closed send window, a paused
    // sequence or a missing provider are all about the sequence or the
    // workspace — reporting them per lead would hide the reason that actually
    // applies to this person.
    const hard = leadBlockers(blockers);
    if (!sendable && hard.length > 0) {
      skipped.push({ leadId, name: lead.person.fullName, reason: hard[0].message });
      continue;
    }
    enrollable.push(leadId);
  }

  if (enrollable.length === 0) {
    throw new MutationError(
      skipped.length === 1
        ? skipped[0].reason
        : `None of the ${input.leadIds.length} leads could be enrolled. ${skipped[0]?.reason ?? ""}`,
      "none_enrollable",
      422
    );
  }

  return mutate(ctx, PERMISSIONS.OUTREACH_SEND, async () => {
    const firstStep = sequence.steps[0];
    const firstSend = nextSendWindow(
      new Date(now.getTime() + firstStep.dayOffset * 86_400_000),
      sequence
    );

    await db.sequenceEnrollment.createMany({
      data: enrollable.map((leadId) => ({
        workspaceId: ctx.workspaceId,
        sequenceId,
        leadId,
        state: "active",
        currentStep: 0,
        nextSendAt: firstSend,
      })),
      skipDuplicates: true,
    });

    if (sequence.isActive) {
      await enqueue(
        JOB.ADVANCE_SEQUENCES,
        { workspaceId: ctx.workspaceId },
        { dedupeKey: `advance-${ctx.workspaceId}`, dedupeWindowSec: 30 }
      );
    }

    return {
      result: {
        enrolled: enrollable.length,
        skipped,
        firstSendAt: firstSend.toISOString(),
        note: !ready
          ? `${enrollable.length} enrolled and queued behind the first step. Nothing sends until a mailbox is connected — the enrollments are kept, not dropped, so connecting one is all that is needed.`
          : sequence.isActive
            ? `${enrollable.length} enrolled. First step goes out from ${firstSend.toISOString()}.`
            : `${enrollable.length} enrolled, but the sequence is paused, so nothing sends until you activate it.`,
      },
      log: {
        action: "sequence.enrolled",
        objectType: "Sequence",
        objectId: sequenceId,
        after: { enrolled: enrollable.length, skipped: skipped.length },
        activity: {
          kind: "sequence.enrolled",
          summary: `Enrolled ${enrollable.length} ${enrollable.length === 1 ? "lead" : "leads"} in "${sequence.name}"`,
        },
      },
    };
  });
}

export async function unenrollLead(ctx: AuthContext, sequenceId: string, leadId: string) {
  const enrollment = await loadScoped(
    () =>
      db.sequenceEnrollment.findFirst({
        where: {
          sequenceId,
          leadId,
          workspaceId: ctx.workspaceId,
          lead: leadVisibilityFilter(ctx),
        },
        include: {
          lead: { select: { person: { select: { fullName: true } } } },
          sequence: { select: { name: true } },
        },
      }),
    "That enrollment"
  );

  return mutate(ctx, PERMISSIONS.OUTREACH_SEND, async () => {
    const updated = await db.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        state: "stopped",
        stopReason: `Removed by ${ctx.user.name}`,
        nextSendAt: null,
      },
    });

    return {
      result: {
        enrollment: toPlain(updated),
        note: "Removed. Steps already sent stay on the timeline; nothing further will go out.",
      },
      log: {
        action: "sequence.unenrolled",
        objectType: "SequenceEnrollment",
        objectId: enrollment.id,
        before: { state: enrollment.state, currentStep: enrollment.currentStep },
        after: { state: "stopped" },
        activity: {
          kind: "sequence.unenrolled",
          summary: `Removed ${enrollment.lead.person.fullName} from "${enrollment.sequence.name}"`,
          leadId,
        },
      },
    };
  });
}

/**
 * A dry run of one step against one real lead: what would actually be sent,
 * and whether it could be. This is what makes the editor trustworthy — the
 * preview uses the same renderer and the same rules as the engine.
 */
export async function previewStep(
  ctx: AuthContext,
  opts: { leadId?: string; subject?: string; bodyTemplate: string }
) {
  const lead = opts.leadId
    ? await db.lead.findFirst({
        where: {
          id: opts.leadId,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...leadVisibilityFilter(ctx),
        },
        select: {
          id: true,
          repliedAt: true,
          person: {
            select: {
              fullName: true,
              employments: { where: { isCurrent: true }, select: { title: true }, take: 1 },
              contactMethods: {
                where: {
                  kind: { in: ["WORK_EMAIL", "PERSONAL_EMAIL"] },
                  isLocked: false,
                  value: { not: null },
                },
                select: { value: true, optedOutAt: true, bounceCount: true },
              },
            },
          },
          company: { select: { name: true, city: true, industry: true } },
          signals: { orderBy: { detectedAt: "desc" }, take: 1, select: { title: true } },
          owner: { select: { name: true } },
        },
      })
    : null;

  if (opts.leadId && !lead) return null;

  const values: Record<string, string | null> = lead
    ? {
        first_name: lead.person.fullName.trim().split(/\s+/)[0] ?? null,
        full_name: lead.person.fullName,
        company: lead.company?.name ?? null,
        title: lead.person.employments[0]?.title ?? null,
        city: lead.company?.city ?? null,
        industry: lead.company?.industry ?? null,
        signal: lead.signals[0]?.title ?? null,
        sender_name: lead.owner?.name ?? ctx.user.name,
        sender_first_name:
          (lead.owner?.name ?? ctx.user.name).trim().split(/\s+/)[0] ?? null,
        sender_company: ctx.workspace.name,
      }
    : {};

  const body = render(opts.bodyTemplate, values);
  const subject = render(opts.subject ?? "", values);
  const unresolved = [
    ...new Set([...(body.ok ? [] : body.missing), ...(subject.ok ? [] : subject.missing)]),
  ];
  const unknown = [
    ...new Set([...(body.ok ? [] : body.unknown), ...(subject.ok ? [] : subject.unknown)]),
  ];

  const recipient = lead
    ? resolveRecipient(lead.person.contactMethods, { listed: () => null })
    : { toAddress: null, suppression: null };

  return {
    lead: lead ? { id: lead.id, name: lead.person.fullName } : null,
    toAddress: recipient.toAddress,
    /** Why there is no usable address, when there is not one. */
    recipientBlock: recipient.suppression?.reason ?? null,
    subject: subject.text,
    body: body.text,
    unresolved,
    unknown,
    copyWarnings: reviewCopy(subject.text, body.text),
    provider: activeEmailProvider(),
    configured: await sendingReady(ctx.workspaceId),
  };
}

/**
 * Who is in a sequence and where they are, limited to leads the caller can
 * see — a rep sees their own enrolments, not a colleague's.
 */
export async function listEnrollments(ctx: AuthContext, sequenceId: string) {
  const sequence = await db.sequence.findFirst({ where: { id: sequenceId, workspaceId: ctx.workspaceId, deletedAt: null }, select: { id: true } });
  if (!sequence) return null;
  const rows = await db.sequenceEnrollment.findMany({
    where: { sequenceId, workspaceId: ctx.workspaceId, lead: { deletedAt: null, ...leadVisibilityFilter(ctx) } },
    orderBy: [{ state: "asc" }, { enrolledAt: "desc" }],
    take: 200,
    select: {
      id: true, state: true, currentStep: true, nextSendAt: true, stopReason: true, repliedAt: true, completedAt: true, enrolledAt: true,
      lead: { select: { id: true, person: { select: { fullName: true } }, company: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id, state: r.state, currentStep: r.currentStep, stopReason: r.stopReason,
    nextSendAt: r.nextSendAt?.toISOString() ?? null, repliedAt: r.repliedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null, enrolledAt: r.enrolledAt.toISOString(),
    lead: { id: r.lead.id, name: r.lead.person.fullName, company: r.lead.company.name },
  }));
}
