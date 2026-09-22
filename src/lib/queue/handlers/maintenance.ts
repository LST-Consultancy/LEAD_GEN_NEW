import "server-only";
import { db } from "@/lib/db";
import { formatInrCompact } from "@/lib/format";

const DAY = 86_400_000;

/**
 * §35 / §75 — deal risk detection.
 *
 * Until this ran on a schedule, risk flags only existed because the seed wrote
 * them. This recomputes them from stage dwell time and recorded activity, and
 * — just as importantly — resolves flags whose underlying problem has been
 * fixed, so the board does not accumulate stale warnings.
 */
export async function detectDealRisks(workspaceId: string) {
  const now = new Date();
  const deals = await db.deal.findMany({
    where: { workspaceId, deletedAt: null, status: "OPEN" },
    include: {
      stage: { select: { name: true, stallAfterDays: true, probability: true } },
      company: { select: { name: true } },
      risks: { where: { resolvedAt: null } },
    },
  });

  let raised = 0;
  let resolved = 0;

  for (const deal of deals) {
    const stageAgeDays = Math.floor((now.getTime() - deal.stageEnteredAt.getTime()) / DAY);
    const inactiveDays = deal.lastActivityAt
      ? Math.floor((now.getTime() - deal.lastActivityAt.getTime()) / DAY)
      : null;

    // Each entry decides whether the condition holds right now.
    const conditions: {
      code: string;
      holds: boolean;
      severity: string;
      title: string;
      explanation: string;
      suggestedAction: string;
      evidence: Record<string, unknown>;
    }[] = [
      {
        code: "stage_stalled",
        holds: stageAgeDays > deal.stage.stallAfterDays,
        severity: stageAgeDays > deal.stage.stallAfterDays * 2.5 ? "high" : "medium",
        title: `Stuck in ${deal.stage.name} for ${stageAgeDays} days`,
        explanation: `Deals at this stage normally move within ${deal.stage.stallAfterDays} days. This one has been here ${stageAgeDays}, which historically correlates with a lower close rate.`,
        suggestedAction:
          "Agree a specific next step with a date, or move it to Lost and free up your attention.",
        evidence: {
          stageEnteredAt: deal.stageEnteredAt,
          stageThresholdDays: deal.stage.stallAfterDays,
          actualDays: stageAgeDays,
        },
      },
      {
        code: "no_next_action",
        // Only matters once a deal is being actively worked.
        holds: !deal.nextActionAt && deal.stage.probability >= 20,
        severity: "medium",
        title: "No next action scheduled",
        explanation:
          "Nothing is booked to move this deal forward. Open deals without a next step are the single largest source of silent pipeline loss.",
        suggestedAction: "Add a dated next step, even if it is just a check-in call.",
        evidence: { nextActionAt: null },
      },
      {
        code: "inactive",
        holds: inactiveDays !== null && inactiveDays > 21,
        severity: inactiveDays !== null && inactiveDays > 35 ? "high" : "medium",
        title: `No activity for ${inactiveDays} days`,
        explanation: `The last recorded interaction was ${inactiveDays} days ago. Nothing has been sent or received since.`,
        suggestedAction: "Re-open the conversation with new information rather than a bare follow-up.",
        evidence: { lastActivityAt: deal.lastActivityAt, inactiveDays },
      },
      {
        code: "close_date_passed",
        holds: Boolean(deal.expectedCloseAt && deal.expectedCloseAt < now),
        severity: "medium",
        title: "Expected close date has passed",
        explanation: `The owner expected this to close by ${deal.expectedCloseAt?.toLocaleDateString("en-IN")}. It is still open, so either the date or the forecast needs revising.`,
        suggestedAction: "Re-set the expected close date so the forecast stops overstating this month.",
        evidence: { expectedCloseAt: deal.expectedCloseAt },
      },
      {
        code: "single_threaded",
        // A large account known through one person is fragile.
        holds: false,
        severity: "medium",
        title: "Only one contact known at this account",
        explanation: "",
        suggestedAction: "",
        evidence: {},
      },
    ];

    // Single-threading needs a count, so it is resolved separately.
    const contactCount = await db.employment.count({
      where: { workspaceId, companyId: deal.companyId, isCurrent: true },
    });
    const singleThreaded = conditions.find((c) => c.code === "single_threaded")!;
    singleThreaded.holds = contactCount <= 1 && Number(deal.valueInr) >= 1_000_000;
    singleThreaded.explanation = `${deal.company.name} is worth ${formatInrCompact(Number(deal.valueInr))} but only one person there is on record. If they leave or go quiet, the deal has nowhere to go.`;
    singleThreaded.suggestedAction = "Identify and reveal a second stakeholder.";
    singleThreaded.evidence = { knownContacts: contactCount };

    const existing = new Map(deal.risks.map((r) => [r.code, r]));

    for (const c of conditions) {
      const open = existing.get(c.code);

      if (c.holds && !open) {
        await db.dealRisk.upsert({
          where: { dealId_code: { dealId: deal.id, code: c.code } },
          create: {
            workspaceId,
            dealId: deal.id,
            code: c.code,
            severity: c.severity,
            title: c.title,
            explanation: c.explanation,
            evidence: c.evidence as never,
            suggestedAction: c.suggestedAction,
            detectedAt: now,
          },
          update: {
            severity: c.severity,
            title: c.title,
            explanation: c.explanation,
            evidence: c.evidence as never,
            suggestedAction: c.suggestedAction,
            resolvedAt: null,
            detectedAt: now,
          },
        });
        raised++;
      } else if (c.holds && open) {
        // Refresh the wording so the day count in the title stays accurate.
        await db.dealRisk.update({
          where: { id: open.id },
          data: {
            severity: c.severity,
            title: c.title,
            explanation: c.explanation,
            evidence: c.evidence as never,
          },
        });
      } else if (!c.holds && open) {
        // The problem went away, so the warning must too.
        await db.dealRisk.update({
          where: { id: open.id },
          data: { resolvedAt: now },
        });
        resolved++;
      }
    }
  }

  return { workspaceId, dealsChecked: deals.length, raised, resolved };
}

/**
 * §81 — auto-archive after the workspace's inactivity window. Archived leads
 * stay searchable; this is decluttering, not deletion.
 */
export async function archiveStaleLeads(workspaceId: string) {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { archiveAfterDays: true },
  });
  const cutoff = new Date(Date.now() - workspace.archiveAfterDays * DAY);

  const stale = await db.lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      archivedAt: null,
      discardedAt: null,
      // Never archive something with a live commitment attached.
      repliedAt: null,
      deals: { none: { status: "OPEN", deletedAt: null } },
      tasks: { none: { status: { in: ["QUEUED", "WORKING", "NEEDS_ATTENTION"] }, deletedAt: null } },
      OR: [
        { lastActivityAt: { lt: cutoff } },
        { AND: [{ lastActivityAt: null }, { surfacedAt: { lt: cutoff } }] },
      ],
    },
    select: { id: true, person: { select: { fullName: true } } },
    take: 500,
  });

  if (stale.length === 0) {
    return { workspaceId, archived: 0, afterDays: workspace.archiveAfterDays };
  }

  const now = new Date();
  await db.lead.updateMany({
    where: { id: { in: stale.map((l) => l.id) } },
    data: { archivedAt: now },
  });

  await db.activity.create({
    data: {
      workspaceId,
      kind: "leads.auto_archived",
      summary: `${stale.length} inactive ${stale.length === 1 ? "lead" : "leads"} archived automatically`,
      detail: `No activity for ${workspace.archiveAfterDays} days, no open deal and no open task. Still fully searchable.`,
      actorType: "SYSTEM",
      metadata: { leadIds: stale.map((l) => l.id) } as never,
    },
  });

  return { workspaceId, archived: stale.length, afterDays: workspace.archiveAfterDays };
}

/**
 * §82 — retention is a promise, so it runs on a schedule. Entries past their
 * purge date are hard-deleted; everything else is left alone.
 */
export async function purgeRecycleBin(workspaceId: string) {
  const now = new Date();
  const due = await db.deletedRecord.findMany({
    where: { workspaceId, restoredAt: null, purgeAfter: { lt: now } },
    take: 500,
  });

  if (due.length === 0) return { workspaceId, purged: 0, byType: {} as Record<string, number> };

  const byType: Record<string, number> = {};
  for (const record of due) {
    byType[record.objectType] = (byType[record.objectType] ?? 0) + 1;
    try {
      switch (record.objectType) {
        case "Note":
          await db.note.deleteMany({ where: { id: record.objectId, workspaceId } });
          break;
        case "Task":
          await db.task.deleteMany({ where: { id: record.objectId, workspaceId } });
          break;
        case "Deal":
          await db.deal.deleteMany({ where: { id: record.objectId, workspaceId } });
          break;
        case "Lead":
          await db.lead.deleteMany({ where: { id: record.objectId, workspaceId } });
          break;
        default:
          // An unknown type is left in place rather than guessed at.
          console.warn(`[purge] unhandled objectType ${record.objectType}, skipping`);
          continue;
      }
      await db.deletedRecord.delete({ where: { id: record.id } });
    } catch (err) {
      // A foreign key may still reference the row; leave it for the next run.
      console.error(`[purge] could not remove ${record.objectType} ${record.objectId}:`, err);
    }
  }

  return { workspaceId, purged: due.length, byType };
}

/**
 * §9 — re-ranks the worklist.
 *
 * The scores were written once by the seed, but they depend on deadline
 * proximity, which moves every hour. Without this the ranking silently goes
 * stale and "Do this now" stops meaning now.
 */
export async function rescoreWorklist(workspaceId: string) {
  const now = Date.now();
  const tasks = await db.task.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: { in: ["QUEUED", "WORKING", "NEEDS_ATTENTION"] },
    },
    include: {
      lead: {
        select: {
          intent: true,
          tier: true,
          repliedAt: true,
          score: { select: { composite: true } },
          signals: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
        },
      },
      deal: {
        select: { valueInr: true, stage: { select: { probability: true } } },
      },
    },
  });

  let updated = 0;

  for (const task of tasks) {
    const factors: string[] = [];
    let score = { LOW: 18, MEDIUM: 34, HIGH: 50, URGENT: 64 }[task.priority] ?? 34;
    factors.push(`${task.priority.toLowerCase()} priority`);

    // Deadline proximity — the part that changes hourly.
    if (task.dueAt) {
      const hours = (task.dueAt.getTime() - now) / 3_600_000;
      if (hours < 0) {
        score += 18;
        factors.push(`overdue by ${Math.abs(Math.round(hours / 24))}d`);
      } else if (hours <= 24) {
        score += 12;
        factors.push("due within a day");
      } else if (hours <= 72) {
        score += 6;
        factors.push("due this week");
      }
    }

    // A reply outranks almost everything: someone is waiting on a human.
    if (task.lead?.repliedAt) {
      score += 16;
      factors.push("they have replied and are waiting");
    }
    if (task.lead?.intent === "BUYING") {
      score += 10;
      factors.push("actively buying");
    } else if (task.lead?.intent === "HOT") {
      score += 6;
      factors.push("hot intent");
    }
    if (task.lead?.tier === "A") {
      score += 6;
      factors.push("Tier A account");
    }

    // Money at stake, weighted by how likely it is to land.
    const dealValue = task.deal ? Number(task.deal.valueInr) : 0;
    const weighted = dealValue * ((task.deal?.stage.probability ?? 0) / 100);
    if (weighted >= 2_000_000) {
      score += 10;
      factors.push(`${formatInrCompact(dealValue)} in play`);
    } else if (weighted >= 500_000) {
      score += 5;
      factors.push(`${formatInrCompact(dealValue)} in play`);
    }

    // Signal freshness: acting on a stale trigger converts far worse.
    const freshest = task.lead?.signals[0]?.occurredAt;
    if (freshest) {
      const days = (now - freshest.getTime()) / DAY;
      if (days <= 2) {
        score += 8;
        factors.push("signal under 48 hours old");
      } else if (days > 30) {
        score -= 6;
        factors.push("signal is over a month old");
      }
    }

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));
    const reason = `Ranked ${finalScore}/100: ${factors.join(", ")}.`;

    if (task.priorityScore === finalScore) continue;

    await db.task.update({
      where: { id: task.id },
      data: {
        priorityScore: finalScore,
        // Only overwrite the explanation for ranks this job owns. A reason
        // written by an agent, with real reasoning behind it, is left alone.
        ...(task.createdByAi ? {} : { priorityReason: reason }),
        expectedImpactInr: dealValue > 0 ? dealValue : task.expectedImpactInr,
      },
    });
    updated++;
  }

  return { workspaceId, tasksConsidered: tasks.length, updated };
}
