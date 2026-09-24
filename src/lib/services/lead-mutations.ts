import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import {
  MutationError,
  clearDeletedRecord,
  loadScoped,
  mutate,
  softDelete,
  touchLead,
} from "@/lib/services/mutate";
import { POINT_COSTS, refundPoints, spendPoints } from "@/lib/services/points";
import { enqueue } from "@/lib/queue/producer";
import { JOB } from "@/lib/queue/jobs";
import { titleAuthority } from "@/lib/opportunities/authority";

/** Loads a lead the caller is allowed to act on, or throws a 404. */
async function scopedLead(ctx: AuthContext, leadId: string) {
  return loadScoped(
    () =>
      db.lead.findFirst({
        where: {
          id: leadId,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...leadVisibilityFilter(ctx),
        },
        include: {
          person: { select: { id: true, fullName: true } },
          company: { select: { id: true, name: true } },
        },
      }),
    "That lead"
  );
}

// ---------------------------------------------------------------------------
// Simple field updates
// ---------------------------------------------------------------------------

export const updateLeadSchema = z.object({
  isStarred: z.boolean().optional(),
  status: z
    .enum(["NEW", "WORKING", "CONTACTED", "REPLIED", "QUALIFIED", "NURTURE", "UNQUALIFIED"])
    .optional(),
  ownerId: z.string().uuid().nullable().optional(),
  tier: z.enum(["A", "B", "C", "D"]).optional(),
  estimatedBudgetInr: z.number().min(0).max(100_000_000_000).nullable().optional(),
  nextActionLabel: z.string().trim().max(200).nullable().optional(),
  nextActionAt: z.coerce.date().nullable().optional(),
});

export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export async function updateLead(ctx: AuthContext, leadId: string, raw: UpdateLeadInput) {
  const input = updateLeadSchema.parse(raw);
  const lead = await scopedLead(ctx, leadId);

  // Reassigning a lead is a different privilege from editing one.
  if (input.ownerId !== undefined && input.ownerId !== lead.ownerId) {
    if (!ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL)) {
      throw new MutationError(
        "Reassigning a lead needs permission to see the whole team's leads.",
        "forbidden",
        403
      );
    }
    if (input.ownerId !== null) {
      await loadScoped(
        () =>
          db.workspaceMember.findFirst({
            where: { workspaceId: ctx.workspaceId, userId: input.ownerId!, deletedAt: null },
          }),
        "That team member"
      );
    }
  }

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const before = {
      isStarred: lead.isStarred,
      status: lead.status,
      ownerId: lead.ownerId,
      tier: lead.tier,
      estimatedBudgetInr: lead.estimatedBudgetInr ? Number(lead.estimatedBudgetInr) : null,
      nextActionLabel: lead.nextActionLabel,
    };

    const updated = await db.lead.update({
      where: { id: leadId },
      data: {
        ...input,
        // Any edit counts as touching the lead.
        lastActivityAt: new Date(),
        // Moving a lead to REPLIED without a recorded reply would make the
        // dormancy filters lie, so stamp it.
        ...(input.status === "REPLIED" && !lead.repliedAt ? { repliedAt: new Date() } : {}),
      },
      include: { owner: { select: { id: true, name: true, avatarUrl: true } } },
    });

    const after = {
      isStarred: updated.isStarred,
      status: updated.status,
      ownerId: updated.ownerId,
      tier: updated.tier,
      estimatedBudgetInr: updated.estimatedBudgetInr ? Number(updated.estimatedBudgetInr) : null,
      nextActionLabel: updated.nextActionLabel,
    };

    // A star is a private bookmark; it does not belong in the team feed.
    const onlyStarChanged =
      Object.keys(input).length === 1 && input.isStarred !== undefined;

    // Status and budget feed the score; a star does not.
    if (input.status !== undefined || input.estimatedBudgetInr !== undefined) {
      await enqueue(
        JOB.RESCORE_LEAD,
        { workspaceId: ctx.workspaceId, leadId, reason: "lead fields changed" },
        { dedupeKey: `rescore-lead-${leadId}` }
      );
    }

    return {
      result: toPlain({
        id: updated.id,
        isStarred: updated.isStarred,
        status: updated.status,
        tier: updated.tier,
        ownerId: updated.ownerId,
        owner: updated.owner,
        estimatedBudgetInr: updated.estimatedBudgetInr,
        nextActionLabel: updated.nextActionLabel,
        nextActionAt: updated.nextActionAt,
        lastActivityAt: updated.lastActivityAt,
      }),
      log: {
        action: "lead.updated",
        objectType: "Lead",
        objectId: leadId,
        before,
        after,
        activity: onlyStarChanged
          ? undefined
          : {
              kind: "lead.updated",
              summary: describeLeadChange(lead.person.fullName, before, after),
              leadId,
              companyId: lead.companyId,
            },
      },
    };
  });
}

function describeLeadChange(
  name: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string {
  const parts: string[] = [];
  if (before.status !== after.status) {
    parts.push(`status ${String(before.status).toLowerCase()} → ${String(after.status).toLowerCase()}`);
  }
  if (before.ownerId !== after.ownerId) parts.push("reassigned");
  if (before.tier !== after.tier) parts.push(`tier ${before.tier} → ${after.tier}`);
  if (before.estimatedBudgetInr !== after.estimatedBudgetInr) parts.push("estimated value changed");
  if (before.nextActionLabel !== after.nextActionLabel) parts.push("next action set");
  return parts.length > 0 ? `${name}: ${parts.join(", ")}` : `${name} updated`;
}

// ---------------------------------------------------------------------------
// Archive / restore / discard
// ---------------------------------------------------------------------------

export async function archiveLead(ctx: AuthContext, leadId: string) {
  const lead = await scopedLead(ctx, leadId);
  if (lead.archivedAt) throw new MutationError("That lead is already archived.");

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const now = new Date();
    await db.lead.update({ where: { id: leadId }, data: { archivedAt: now } });
    // Archived leads stay searchable, so they are not recycle-bin entries.
    return {
      result: { id: leadId, archivedAt: now.toISOString() },
      log: {
        action: "lead.archived",
        objectType: "Lead",
        objectId: leadId,
        before: { archivedAt: null },
        after: { archivedAt: now },
        activity: {
          kind: "lead.archived",
          summary: `${lead.person.fullName} archived`,
          detail: "Still searchable, and restorable at any time.",
          leadId,
          companyId: lead.companyId,
        },
      },
    };
  });
}

export async function restoreLead(ctx: AuthContext, leadId: string) {
  // Restoring has to look past the archived filter that scopedLead applies.
  const lead = await loadScoped(
    () =>
      db.lead.findFirst({
        where: {
          id: leadId,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...leadVisibilityFilter(ctx),
        },
        include: { person: { select: { fullName: true } } },
      }),
    "That lead"
  );

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    await db.lead.update({
      where: { id: leadId },
      data: { archivedAt: null, discardedAt: null, discardReason: null },
    });
    await clearDeletedRecord(ctx, "Lead", leadId);
    return {
      result: { id: leadId, archivedAt: null },
      log: {
        action: "lead.restored",
        objectType: "Lead",
        objectId: leadId,
        activity: {
          kind: "lead.restored",
          summary: `${lead.person.fullName} restored`,
          leadId,
          companyId: lead.companyId,
        },
      },
    };
  });
}

export const discardSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

/**
 * Discarding is the feedback signal that a lead should never have surfaced.
 * The reason is required because it is the only way the targeting improves.
 */
export async function discardLead(ctx: AuthContext, leadId: string, rawReason: string) {
  const { reason } = discardSchema.parse({ reason: rawReason });
  const lead = await scopedLead(ctx, leadId);

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const now = new Date();
    await db.lead.update({
      where: { id: leadId },
      data: { discardedAt: now, discardReason: reason, status: "UNQUALIFIED" },
    });
    await softDelete(ctx, {
      objectType: "Lead",
      objectId: leadId,
      label: `${lead.person.fullName} — ${lead.company.name}`,
    });
    return {
      result: { id: leadId, discardedAt: now.toISOString() },
      log: {
        action: "lead.discarded",
        objectType: "Lead",
        objectId: leadId,
        after: { reason },
        activity: {
          kind: "lead.discarded",
          summary: `${lead.person.fullName} discarded`,
          detail: reason,
          leadId,
          companyId: lead.companyId,
        },
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Contact reveal — the one mutation that spends money
// ---------------------------------------------------------------------------

export type RevealResult = {
  leadId: string;
  revealed: { id: string; kind: string; value: string; status: string }[];
  pointsSpent: number;
  balance: number;
  skipped: { kind: string; reason: string }[];
};

/**
 * Reveals locked contact details for a lead's person.
 *
 * Charges one point per contact method actually unlocked. A method with no
 * underlying value is never charged for, and if the spend succeeds but the
 * unlock then fails, the points are refunded — the user must never pay for
 * nothing (§127).
 */
export async function revealContacts(
  ctx: AuthContext,
  leadId: string,
  opts: { contactMethodIds?: string[]; idempotencyKey?: string } = {}
): Promise<RevealResult> {
  const lead = await scopedLead(ctx, leadId);

  return mutate(ctx, PERMISSIONS.LEADS_REVEAL, async () => {
    const candidates = await db.contactMethod.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        personId: lead.personId,
        isLocked: true,
        ...(opts.contactMethodIds?.length ? { id: { in: opts.contactMethodIds } } : {}),
      },
      orderBy: [{ isPrimary: "desc" }, { confidence: "desc" }],
    });

    if (candidates.length === 0) {
      throw new MutationError(
        "There is nothing locked left to reveal for this person. No points were charged.",
        "nothing_to_reveal",
        409
      );
    }

    const skipped: RevealResult["skipped"] = [];
    const unlockable = candidates.filter((c) => {
      if (!c.value) {
        // The provider knows a method exists but returned no value; charging
        // for that would be charging for nothing.
        skipped.push({
          kind: c.kind,
          reason: "The source has no value for this method, so it wasn't charged for.",
        });
        return false;
      }
      if (c.optedOutAt) {
        skipped.push({ kind: c.kind, reason: "This person has opted out of contact." });
        return false;
      }
      return true;
    });

    if (unlockable.length === 0) {
      throw new MutationError(
        "None of those contacts could be revealed. No points were charged.",
        "nothing_to_reveal",
        409
      );
    }

    const cost = unlockable.length * POINT_COSTS.REVEAL_CONTACT;
    const idempotencyKey = opts.idempotencyKey ?? `reveal-${leadId}-${randomUUID()}`;

    // Spend first: if the balance is short this throws before anything unlocks.
    const spend = await spendPoints(ctx, {
      type: "REVEAL",
      amount: cost,
      reason: `Revealed ${unlockable.length} contact ${unlockable.length === 1 ? "detail" : "details"} for ${lead.person.fullName}`,
      refType: "Lead",
      refId: leadId,
      idempotencyKey,
    });

    let revealed: RevealResult["revealed"];
    try {
      const now = new Date();
      await db.$transaction(
        unlockable.map((c) =>
          db.contactMethod.update({
            where: { id: c.id },
            data: { isLocked: false, revealedAt: now, revealedByUserId: ctx.userId },
          })
        )
      );
      await db.lead.update({
        where: { id: leadId },
        data: { isRevealed: true, lastActivityAt: now },
      });
      revealed = unlockable.map((c) => ({
        id: c.id,
        kind: c.kind,
        value: c.value!,
        status: c.status,
      }));

      // Reachability is a scored dimension, so the score is now stale. Queued
      // rather than awaited: the user should not wait on a recompute, and a
      // queue outage must not fail a reveal they have already paid for.
      await enqueue(
        JOB.RESCORE_LEAD,
        { workspaceId: ctx.workspaceId, leadId, reason: "contacts revealed" },
        { dedupeKey: `rescore-lead-${leadId}` }
      );
    } catch (err) {
      // The charge landed but the unlock did not. Give the points back and say so.
      await refundPoints(ctx, {
        amount: cost,
        reason: `Refund: reveal failed for ${lead.person.fullName}, no contact was returned`,
        refType: "Lead",
        refId: leadId,
        idempotencyKey: `${idempotencyKey}:refund`,
      });
      console.error("[reveal] unlock failed after charging; refunded", err);
      throw new MutationError(
        "We couldn't verify those contacts. Your points have been refunded.",
        "reveal_failed",
        502
      );
    }

    return {
      result: {
        leadId,
        revealed,
        pointsSpent: cost,
        balance: spend.balanceAfter,
        skipped,
      },
      log: {
        action: "lead.revealed",
        objectType: "Lead",
        objectId: leadId,
        after: { kinds: revealed.map((r) => r.kind), pointsSpent: cost },
        activity: {
          kind: "lead.revealed",
          summary: `Revealed ${revealed.length} contact ${revealed.length === 1 ? "detail" : "details"} for ${lead.person.fullName}`,
          detail: revealed.map((r) => r.kind.toLowerCase().replace(/_/g, " ")).join(", "),
          leadId,
          companyId: lead.companyId,
        },
      },
    };
  });
}

/** What a reveal would cost, so the UI can state the price before charging. */
export async function quoteReveal(ctx: AuthContext, leadId: string) {
  const lead = await scopedLead(ctx, leadId);
  const locked = await db.contactMethod.findMany({
    where: { workspaceId: ctx.workspaceId, personId: lead.personId, isLocked: true },
    select: { id: true, kind: true, value: true, status: true, confidence: true, optedOutAt: true },
  });
  const chargeable = locked.filter((c) => c.value && !c.optedOutAt);
  return {
    leadId,
    chargeable: chargeable.map((c) => ({
      id: c.id,
      kind: c.kind,
      status: c.status,
      confidence: c.confidence,
    })),
    cost: chargeable.length * POINT_COSTS.REVEAL_CONTACT,
  };
}

// ---------------------------------------------------------------------------
// Score override — §72/§73 feedback loop
// ---------------------------------------------------------------------------

export const scoreOverrideSchema = z.object({
  score: z.number().min(0).max(10).nullable(),
  reason: z.string().trim().max(400).optional(),
});

/**
 * Lets a human disagree with the engine. The computed score is kept alongside
 * the override so the disagreement itself is the training signal, rather than
 * being overwritten and lost.
 */
export async function overrideLeadScore(
  ctx: AuthContext,
  leadId: string,
  raw: z.infer<typeof scoreOverrideSchema>
) {
  const input = scoreOverrideSchema.parse(raw);
  const lead = await scopedLead(ctx, leadId);
  const score = await loadScoped(
    () => db.leadScore.findUnique({ where: { leadId } }),
    "A score for that lead"
  );

  if (input.score !== null && !input.reason) {
    throw new MutationError(
      "Please say why you disagree — the reason is what improves future scoring.",
      "reason_required",
      400
    );
  }

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const updated = await db.leadScore.update({
      where: { leadId },
      data: {
        overriddenScore: input.score,
        overriddenById: input.score === null ? null : ctx.userId,
        overrideReason: input.score === null ? null : (input.reason ?? null),
      },
    });
    await touchLead(leadId);

    return {
      result: toPlain({
        leadId,
        computedScore: Number(updated.displayScore),
        overriddenScore: updated.overriddenScore ? Number(updated.overriddenScore) : null,
        overrideReason: updated.overrideReason,
      }),
      log: {
        action: input.score === null ? "lead.score_override_cleared" : "lead.score_overridden",
        objectType: "LeadScore",
        objectId: score.id,
        before: {
          overriddenScore: score.overriddenScore ? Number(score.overriddenScore) : null,
        },
        after: {
          overriddenScore: input.score,
          computedScore: Number(score.displayScore),
          reason: input.reason ?? null,
        },
        activity: {
          kind: "lead.score_overridden",
          summary:
            input.score === null
              ? `Score override removed for ${lead.person.fullName}`
              : `Score for ${lead.person.fullName} set to ${input.score} (engine said ${Number(score.displayScore)})`,
          detail: input.reason,
          leadId,
          companyId: lead.companyId,
        },
      },
    };
  });
}

/**
 * Corrects the facts about the person behind a lead: name, current title,
 * LinkedIn and city. Company is not editable here — a move to another company
 * is a job change, not a typo, and would rewrite the lead's history.
 *
 * Authority is re-derived from the new title the same way discovery does it,
 * so a corrected title cannot leave a stale "decision maker" flag behind.
 */
export const leadDetailsSchema = z.object({
  fullName: z.string().trim().min(2, "A name needs at least two characters.").max(160).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  linkedinUrl: z
    .string().trim().max(400)
    .refine((v) => v === "" || /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#\s]+\/?$/i.test(v), "That isn't a LinkedIn profile URL (https://www.linkedin.com/in/…).")
    .transform((v) => v || null)
    .nullable()
    .optional(),
  city: z.string().trim().max(120).transform((v) => v || null).nullable().optional(),
});

export async function updateLeadDetails(ctx: AuthContext, leadId: string, raw: z.input<typeof leadDetailsSchema>) {
  const input = leadDetailsSchema.parse(raw);
  const lead = await scopedLead(ctx, leadId);
  if (Object.keys(input).length === 0) throw new MutationError("Nothing to change.", "nothing_to_change", 400);

  if (input.linkedinUrl) {
    const taken = await db.person.findFirst({ where: { workspaceId: ctx.workspaceId, linkedinUrl: input.linkedinUrl, deletedAt: null, id: { not: lead.personId } }, select: { fullName: true } });
    if (taken) throw new MutationError(`That LinkedIn profile already belongs to ${taken.fullName} in this workspace. If they are the same person, keep that record instead.`, "duplicate_linkedin", 409);
  }

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const person = await db.person.findUniqueOrThrow({ where: { id: lead.personId } });
    const employment = await db.employment.findFirst({ where: { workspaceId: ctx.workspaceId, personId: lead.personId, companyId: lead.companyId, isCurrent: true } });
    const before = { fullName: person.fullName, title: employment?.title ?? null, linkedinUrl: person.linkedinUrl, city: person.city };

    const [firstName, ...rest] = (input.fullName ?? person.fullName).split(/\s+/);
    await db.person.update({
      where: { id: person.id },
      data: {
        ...(input.fullName ? { fullName: input.fullName, firstName, lastName: rest.join(" ") || null } : {}),
        ...(input.linkedinUrl !== undefined ? { linkedinUrl: input.linkedinUrl } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
      },
    });
    if (input.title) {
      const { seniority, likelyDecisionMaker } = titleAuthority(input.title);
      if (employment) await db.employment.update({ where: { id: employment.id }, data: { title: input.title, seniority, isDecisionMaker: likelyDecisionMaker } });
      else await db.employment.create({ data: { workspaceId: ctx.workspaceId, personId: person.id, companyId: lead.companyId, title: input.title, seniority, isDecisionMaker: likelyDecisionMaker, isCurrent: true } });
      // Seniority feeds the score.
      await enqueue(JOB.RESCORE_LEAD, { workspaceId: ctx.workspaceId, leadId, reason: "title corrected" }, { dedupeKey: `rescore-lead-${leadId}` });
    }
    await touchLead(leadId);
    const after = { fullName: input.fullName ?? before.fullName, title: input.title ?? before.title, linkedinUrl: input.linkedinUrl !== undefined ? input.linkedinUrl : before.linkedinUrl, city: input.city !== undefined ? input.city : before.city };
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => after[k] !== before[k]);

    return {
      result: toPlain({ id: leadId, ...after }),
      log: {
        action: "lead.details_updated", objectType: "Lead", objectId: leadId, before, after,
        activity: changed.length ? { kind: "lead.details_updated", summary: `${after.fullName}: ${changed.map((k) => ({ fullName: "name", title: "title", linkedinUrl: "LinkedIn", city: "city" })[k]).join(", ")} corrected`, leadId, companyId: lead.companyId } : undefined,
      },
    };
  });
}
