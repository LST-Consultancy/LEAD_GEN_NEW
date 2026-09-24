import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { toPlain } from "@/lib/serialize";

const DAY = 86_400_000;

type MovementRow = {
  dealId: string;
  valueAtMove: unknown;
  createdAt: Date;
  fromStageId: string | null;
  toStageId: string;
  toStage: { sortOrder: number };
};

/**
 * Collapses a window of stage-change rows into one net movement per deal.
 *
 * A deal created three days ago may have walked New → Contacted → Replied →
 * Qualified, producing four history rows all inside a seven-day window. Summing
 * them would count that deal's value four times, which is how "moved forward"
 * ends up exceeding total open pipeline. Comparing each deal's first origin
 * stage with its last destination stage counts it once, in the direction it
 * actually travelled.
 */
function netMovement(
  rows: MovementRow[],
  stageOrder: Map<string, number>
): { forwardInr: number; forwardCount: number; backwardInr: number; backwardCount: number } {
  // The caller must supply the authoritative stage order. Inferring it from the
  // rows is not safe: a deal's origin stage may never appear as any row's
  // destination, and it would then be read as "entered the pipeline" rather
  // than "moved forward".
  const order = stageOrder;

  const perDeal = new Map<
    string,
    { firstFrom: number | null; lastTo: number; value: number }
  >();

  // Rows arrive in ascending time order, so the first row seen for a deal holds
  // its origin and the last one seen holds its destination.
  for (const r of rows) {
    const to = order.get(r.toStageId) ?? r.toStage.sortOrder;
    const from = r.fromStageId ? (order.get(r.fromStageId) ?? null) : null;
    const value = Number(r.valueAtMove);
    const existing = perDeal.get(r.dealId);
    if (!existing) {
      perDeal.set(r.dealId, { firstFrom: from, lastTo: to, value });
    } else {
      existing.lastTo = to;
      existing.value = value;
    }
  }

  let forwardInr = 0;
  let forwardCount = 0;
  let backwardInr = 0;
  let backwardCount = 0;

  for (const { firstFrom, lastTo, value } of perDeal.values()) {
    // A deal whose first row has no origin entered the pipeline in this window
    // rather than moving within it; that is counted as "entered", not "moved".
    if (firstFrom === null) continue;
    if (lastTo > firstFrom) {
      forwardInr += value;
      forwardCount++;
    } else if (lastTo < firstFrom) {
      backwardInr += value;
      backwardCount++;
    }
  }

  return { forwardInr, forwardCount, backwardInr, backwardCount };
}


/**
 * Everything the Today screen shows. Composed of independent sections so a
 * failure in one panel degrades that panel rather than the whole screen (§96).
 */
export async function getToday(ctx: AuthContext) {
  const [brief, revenue, worklist, leadOfDay, health, motion, heatmap, coach, digest, notes, dailyBrief] =
    await Promise.all([
      getChangesSinceYesterday(ctx),
      getRevenueInReach(ctx),
      getWorklist(ctx),
      getLeadOfTheDay(ctx),
      getSalesHealth(ctx),
      getRevenueInMotion(ctx, 7),
      getActivityHeatmap(ctx),
      getCoachTip(ctx),
      getAutopilotDigest(ctx),
      getStickyNotes(ctx),
      getDailyBriefInsight(ctx),
    ]);

  return { brief, revenue, worklist, leadOfDay, health, motion, heatmap, coach, digest, notes, dailyBrief };
}

// --------------------------------------------------------------------------
// §6 — the Copilot brief. Every clause is a counted fact with a link behind it.
// --------------------------------------------------------------------------

export async function getChangesSinceYesterday(ctx: AuthContext) {
  const since = new Date(Date.now() - DAY);
  const visibility = leadVisibilityFilter(ctx);

  const [
    newSignals,
    intentRisers,
    repliesNeedingYou,
    stalledDeals,
    dueFollowUps,
    newLeads,
    proposalViews,
    meetingsToday,
  ] = await Promise.all([
    db.signal.count({
      where: { workspaceId: ctx.workspaceId, detectedAt: { gte: since }, deletedAt: null },
    }),
    db.lead.count({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        archivedAt: null,
        ...visibility,
        tier: { in: ["A", "B"] },
        intent: { in: ["HOT", "BUYING"] },
        signals: { some: { detectedAt: { gte: since } } },
      },
    }),
    db.conversation.count({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        state: "NEEDS_YOU",
        ...(visibility.ownerId ? { assigneeId: visibility.ownerId } : {}),
      },
    }),
    db.deal.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        status: "OPEN",
        ...(visibility.ownerId ? { ownerId: visibility.ownerId } : {}),
        risks: { some: { resolvedAt: null, code: { in: ["stage_stalled", "inactive"] } } },
      },
      select: { id: true, valueInr: true },
    }),
    db.task.count({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        ownerId: ctx.userId,
        status: { in: ["QUEUED", "WORKING", "NEEDS_ATTENTION"] },
        dueAt: { lte: new Date(Date.now() + DAY) },
      },
    }),
    db.lead.count({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        ...visibility,
        createdAt: { gte: since },
      },
    }),
    db.proposalView.count({
      where: { workspaceId: ctx.workspaceId, viewedAt: { gte: since } },
    }),
    db.booking.count({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        startsAt: { gte: new Date(), lte: new Date(Date.now() + DAY) },
        ...(visibility.ownerId ? { hostUserId: visibility.ownerId } : {}),
      },
    }),
  ]);

  const stalledValue = stalledDeals.reduce((sum, d) => sum + Number(d.valueInr), 0);
  const totalChanges = newSignals + repliesNeedingYou + newLeads + proposalViews;

  // Each clause carries the query that produced it, so "Show me" is always real.
  const clauses: { text: string; count: number; href: string; tone: "neutral" | "good" | "risk" }[] = [];
  if (intentRisers > 0) {
    clauses.push({
      text: `${intentRisers} ${intentRisers === 1 ? "lead" : "leads"} in your top tiers showed stronger buying intent`,
      count: intentRisers,
      href: "/leads?shortcut=hot-intent",
      tone: "good",
    });
  }
  if (repliesNeedingYou > 0) {
    clauses.push({
      text: `${repliesNeedingYou} ${repliesNeedingYou === 1 ? "reply needs" : "replies need"} you`,
      count: repliesNeedingYou,
      href: "/inbox",
      tone: "good",
    });
  }
  if (stalledValue > 0) {
    clauses.push({
      text: `${stalledDeals.length} ${stalledDeals.length === 1 ? "deal has" : "deals have"} stalled`,
      count: stalledDeals.length,
      href: "/pipeline",
      tone: "risk",
    });
  }
  if (dueFollowUps > 0) {
    clauses.push({
      text: `${dueFollowUps} ${dueFollowUps === 1 ? "follow-up is" : "follow-ups are"} due`,
      count: dueFollowUps,
      href: "/my-queue",
      tone: "neutral",
    });
  }
  if (proposalViews > 0) {
    clauses.push({
      text: `${proposalViews} proposal ${proposalViews === 1 ? "view" : "views"}`,
      count: proposalViews,
      href: "/proposals",
      tone: "good",
    });
  }
  if (meetingsToday > 0) {
    clauses.push({
      text: `${meetingsToday} ${meetingsToday === 1 ? "meeting" : "meetings"} in the next 24 hours`,
      count: meetingsToday,
      href: "/bookings",
      tone: "neutral",
    });
  }

  return toPlain({
    totalChanges,
    newSignals,
    newLeads,
    intentRisers,
    repliesNeedingYou,
    stalledCount: stalledDeals.length,
    stalledValueInr: stalledValue,
    dueFollowUps,
    proposalViews,
    meetingsToday,
    clauses,
    generatedAt: new Date(),
  });
}

// --------------------------------------------------------------------------
// §8 — revenue in reach. Weighted uses each stage's own probability.
// --------------------------------------------------------------------------

export async function getRevenueInReach(ctx: AuthContext) {
  const visibility = leadVisibilityFilter(ctx);
  const ownerScope = visibility.ownerId ? { ownerId: visibility.ownerId } : {};

  const [open, won, riskyDeals, weekStartAdds, movements, watchDeals, allStages] =
    await Promise.all([
    db.deal.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "OPEN", ...ownerScope },
      select: {
        id: true,
        valueInr: true,
        confidence: true,
        expectedCloseAt: true,
        stage: { select: { probability: true, key: true, name: true } },
      },
    }),
    db.deal.aggregate({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        status: "WON",
        wonAt: { gte: new Date(Date.now() - 30 * DAY) },
        ...ownerScope,
      },
      _sum: { valueInr: true },
      _count: true,
    }),
    // "At risk" is reserved for high-severity flags. A deal merely missing a
    // next step is a hygiene issue, reported separately — otherwise almost
    // every open deal qualifies and the number stops meaning anything.
    db.deal.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        status: "OPEN",
        ...ownerScope,
        risks: { some: { resolvedAt: null, severity: "high" } },
      },
      select: { id: true, valueInr: true },
    }),
    db.deal.aggregate({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - 7 * DAY) },
        ...ownerScope,
      },
      _sum: { valueInr: true },
      _count: true,
    }),
    db.dealStageHistory.findMany({
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: new Date(Date.now() - 7 * DAY) } },
      orderBy: { createdAt: "asc" },
      select: {
        dealId: true,
        valueAtMove: true,
        createdAt: true,
        fromStageId: true,
        toStageId: true,
        toStage: { select: { sortOrder: true } },
      },
    }),
    db.deal.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        status: "OPEN",
        ...ownerScope,
        risks: { some: { resolvedAt: null, severity: "medium" } },
      },
      select: { id: true, valueInr: true },
    }),
    db.pipelineStage.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true, sortOrder: true },
    }),
  ]);

  const pipelineInr = open.reduce((s, d) => s + Number(d.valueInr), 0);
  const weightedInr = open.reduce((s, d) => s + Number(d.valueInr) * (d.stage.probability / 100), 0);
  // Commit = late-stage deals the rep has actually called. Deliberately narrower
  // than "weighted", which is a statistical figure rather than a promise.
  const commitInr = open
    .filter((d) => d.stage.probability >= 65 && d.confidence >= 70)
    .reduce((s, d) => s + Number(d.valueInr), 0);
  const bestCaseInr = open
    .filter((d) => d.stage.probability >= 35)
    .reduce((s, d) => s + Number(d.valueInr), 0);
  const atRiskInr = riskyDeals.reduce((s, d) => s + Number(d.valueInr), 0);

  // Net movement per deal, counted once. Summing every hop would multiply a
  // deal that walked three stages in the window by three, which is how a
  // "moved forward" figure ends up larger than the whole pipeline.
  const { forwardInr, backwardInr } = netMovement(
    movements,
    new Map(allStages.map((st) => [st.id, st.sortOrder]))
  );

  const closingThisMonth = open.filter(
    (d) => d.expectedCloseAt && d.expectedCloseAt <= new Date(Date.now() + 30 * DAY)
  );

  return toPlain({
    pipelineInr,
    weightedInr: Math.round(weightedInr),
    commitInr,
    bestCaseInr,
    atRiskInr,
    watchInr: watchDeals.reduce((s, d) => s + Number(d.valueInr), 0),
    watchDealCount: watchDeals.length,
    wonLast30DaysInr: Number(won._sum.valueInr ?? 0),
    wonLast30DaysCount: won._count,
    addedThisWeekInr: Number(weekStartAdds._sum.valueInr ?? 0),
    addedThisWeekCount: weekStartAdds._count,
    movedForwardInr: forwardInr,
    movedBackwardInr: backwardInr,
    openDealCount: open.length,
    atRiskDealCount: riskyDeals.length,
    closingThisMonthInr: closingThisMonth.reduce((s, d) => s + Number(d.valueInr), 0),
    closingThisMonthCount: closingThisMonth.length,
  });
}

// --------------------------------------------------------------------------
// §9 — the worklist. Ranked by impact, never by due date alone.
// --------------------------------------------------------------------------

export async function getWorklist(ctx: AuthContext, limit = 8) {
  const tasks = await db.task.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ownerId: ctx.userId,
      status: { in: ["QUEUED", "WORKING", "NEEDS_ATTENTION"] },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
    },
    orderBy: [{ priorityScore: "desc" }, { dueAt: "asc" }],
    take: limit,
    include: {
      lead: {
        select: {
          id: true,
          tier: true,
          intent: true,
          person: { select: { fullName: true, avatarUrl: true } },
          company: { select: { id: true, name: true } },
          score: { select: { displayScore: true } },
          signals: {
            take: 1,
            orderBy: { occurredAt: "desc" },
            select: { title: true, occurredAt: true, type: true },
          },
        },
      },
      deal: {
        select: { id: true, title: true, valueInr: true, stage: { select: { name: true } } },
      },
      owner: { select: { id: true, name: true } },
    },
  });

  return toPlain(
    tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      priorityScore: t.priorityScore,
      priorityReason: t.priorityReason,
      recommendedAction: t.recommendedAction,
      expectedImpactInr: t.expectedImpactInr,
      revenueImpact: t.revenueImpact,
      channel: t.channel,
      dueAt: t.dueAt,
      isOverdue: t.dueAt ? t.dueAt < new Date() : false,
      createdByAi: t.createdByAi,
      lead: t.lead
        ? {
            id: t.lead.id,
            name: t.lead.person.fullName,
            avatarUrl: t.lead.person.avatarUrl,
            company: t.lead.company.name,
            companyId: t.lead.company.id,
            tier: t.lead.tier,
            intent: t.lead.intent,
            score: t.lead.score ? Number(t.lead.score.displayScore) : null,
            latestSignal: t.lead.signals[0] ?? null,
          }
        : null,
      deal: t.deal
        ? {
            id: t.deal.id,
            title: t.deal.title,
            valueInr: t.deal.valueInr,
            stage: t.deal.stage.name,
          }
        : null,
    }))
  );
}

// --------------------------------------------------------------------------
// §7 — lead of the day.
// --------------------------------------------------------------------------

export async function getLeadOfTheDay(ctx: AuthContext) {
  const lead = await db.lead.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      archivedAt: null,
      discardedAt: null,
      ...leadVisibilityFilter(ctx),
      status: { in: ["NEW", "WORKING", "CONTACTED"] },
      signals: { some: {} },
    },
    orderBy: [{ score: { composite: "desc" } }, { surfacedAt: "desc" }],
    include: {
      person: {
        include: {
          employments: { where: { isCurrent: true }, take: 1 },
          contactMethods: { select: { kind: true, isLocked: true, status: true, optedOutAt: true } },
        },
      },
      company: {
        select: { id: true, name: true, industry: true, city: true, state: true, employeeCount: true, domain: true },
      },
      score: { select: { displayScore: true, composite: true } },
      // Strongest signal first, not newest: this is the evidence the score
      // rests on, so citing a weaker recent one would contradict the headline.
      signals: { orderBy: [{ confidence: "desc" }, { occurredAt: "desc" }], take: 1 },
      nextBestActions: { where: { rejectedAt: null }, orderBy: { rank: "asc" }, take: 1 },
      owner: { select: { id: true, name: true } },
    },
  });

  if (!lead) return null;

  const employment = lead.person.employments[0];
  const signal = lead.signals[0];
  const methods = lead.person.contactMethods.filter((m) => !m.optedOutAt);
  const emails = methods.filter((m) => m.kind === "WORK_EMAIL" || m.kind === "PERSONAL_EMAIL");
  const phones = methods.filter((m) => m.kind === "MOBILE" || m.kind === "DIRECT_PHONE");

  return toPlain({
    id: lead.id,
    tier: lead.tier,
    intent: lead.intent,
    status: lead.status,
    score: lead.score ? Number(lead.score.displayScore) : 0,
    isStarred: lead.isStarred,
    estimatedBudgetInr: lead.estimatedBudgetInr,
    surfacedAt: lead.surfacedAt,
    surfacedReason: lead.surfacedReason,
    person: {
      name: lead.person.fullName,
      avatarUrl: lead.person.avatarUrl,
      linkedinUrl: lead.person.linkedinUrl,
      title: employment?.title ?? "—",
      isDecisionMaker: employment?.isDecisionMaker ?? false,
      location: [lead.person.city, lead.person.state].filter(Boolean).join(", "),
    },
    company: {
      id: lead.company.id,
      name: lead.company.name,
      industry: lead.company.industry,
      location: [lead.company.city, lead.company.state].filter(Boolean).join(", "),
      employeeCount: lead.company.employeeCount,
      domain: lead.company.domain,
    },
    signal: signal
      ? {
          id: signal.id,
          type: signal.type,
          sourceName: signal.sourceName,
          sourceUrl: signal.sourceUrl,
          title: signal.title,
          excerpt: signal.excerpt,
          interpretation: signal.aiInterpretation,
          confidence: signal.confidence,
          suggestedAction: signal.suggestedAction,
          occurredAt: signal.occurredAt,
        }
      : null,
    channels: {
      email: emails.length === 0 ? "none" : emails.some((m) => !m.isLocked) ? "open" : "locked",
      phone: phones.length === 0 ? "none" : phones.some((m) => !m.isLocked) ? "open" : "locked",
      linkedin: methods.some((m) => m.kind === "LINKEDIN_URL") ? "open" : "none",
    },
    nextBestAction: lead.nextBestActions[0] ?? null,
    owner: lead.owner,
  });
}

// --------------------------------------------------------------------------
// §10 — sales health. Never an opaque number: each dimension explains itself.
// --------------------------------------------------------------------------

export async function getSalesHealth(ctx: AuthContext) {
  const visibility = leadVisibilityFilter(ctx);
  const ownerScope = visibility.ownerId ? { ownerId: visibility.ownerId } : {};
  const since30 = new Date(Date.now() - 30 * DAY);

  const [openDeals, stages, wonCount, lostCount, sent, replied, meetings, overdueTasks, totalTasks, dealsNoNext] =
    await Promise.all([
      db.deal.findMany({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "OPEN", ...ownerScope },
        select: {
          valueInr: true,
          stageEnteredAt: true,
          lastActivityAt: true,
          nextActionAt: true,
          stage: { select: { probability: true, stallAfterDays: true, sortOrder: true } },
        },
      }),
      db.pipelineStage.count({ where: { workspaceId: ctx.workspaceId } }),
      db.deal.count({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "WON", wonAt: { gte: since30 }, ...ownerScope },
      }),
      db.deal.count({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "LOST", lostAt: { gte: since30 }, ...ownerScope },
      }),
      db.message.count({
        where: { workspaceId: ctx.workspaceId, direction: "OUTBOUND", sentAt: { gte: since30 } },
      }),
      db.message.count({
        where: { workspaceId: ctx.workspaceId, direction: "INBOUND", createdAt: { gte: since30 } },
      }),
      db.booking.count({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, startsAt: { gte: since30 }, ...(visibility.ownerId ? { hostUserId: visibility.ownerId } : {}) },
      }),
      db.task.count({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ownerId: ctx.userId,
          status: { in: ["QUEUED", "WORKING", "NEEDS_ATTENTION"] },
          dueAt: { lt: new Date() },
        },
      }),
      db.task.count({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ownerId: ctx.userId,
          status: { in: ["QUEUED", "WORKING", "NEEDS_ATTENTION"] },
        },
      }),
      db.deal.count({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "OPEN", nextActionAt: null, ...ownerScope },
      }),
    ]);

  const pipelineInr = openDeals.reduce((s, d) => s + Number(d.valueInr), 0);
  const wonInr = wonCount > 0 ? pipelineInr / Math.max(1, openDeals.length) : 0;

  // A working assumption stated openly rather than hidden: healthy coverage is
  // roughly 3× the trailing monthly won value.
  const targetInr = Math.max(wonInr * 3, 1_000_000);
  const coverage = Math.min(100, Math.round((pipelineInr / (targetInr * 3)) * 100));

  const stalled = openDeals.filter((d) => {
    const days = (Date.now() - d.stageEnteredAt.getTime()) / DAY;
    return days > d.stage.stallAfterDays;
  }).length;
  const momentum = openDeals.length
    ? Math.round(((openDeals.length - stalled) / openDeals.length) * 100)
    : 50;

  const discipline = totalTasks > 0 ? Math.round(((totalTasks - overdueTasks) / totalTasks) * 100) : 100;
  const responseRate = sent > 0 ? Math.min(100, Math.round((replied / sent) * 100 * 4)) : 0;
  const conversion = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 50;

  const avgAgeDays = openDeals.length
    ? openDeals.reduce((s, d) => s + (Date.now() - d.stageEnteredAt.getTime()) / DAY, 0) / openDeals.length
    : 0;
  const aging = Math.max(0, Math.round(100 - avgAgeDays * 3));

  const hotLeads = await db.lead.count({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      archivedAt: null,
      ...visibility,
      intent: { in: ["HOT", "BUYING"] },
    },
  });
  const allLeads = await db.lead.count({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: null, ...visibility },
  });
  const intentHealth = allLeads > 0 ? Math.min(100, Math.round((hotLeads / allLeads) * 100 * 3)) : 0;

  // Concentration risk: how much of the pipeline sits in the largest deal.
  const largest = openDeals.length ? Math.max(...openDeals.map((d) => Number(d.valueInr))) : 0;
  const concentration = pipelineInr > 0 ? Math.max(0, Math.round(100 - (largest / pipelineInr) * 200)) : 50;

  const nextStepHealth = openDeals.length
    ? Math.round(((openDeals.length - dealsNoNext) / openDeals.length) * 100)
    : 100;

  const meetingConversion = replied > 0 ? Math.min(100, Math.round((meetings / replied) * 100)) : 0;

  const dimensions = [
    { key: "coverage", label: "Pipeline coverage", value: coverage, weight: 14, explain: `₹${Math.round(pipelineInr / 100000)}L open across ${openDeals.length} deals against a 3× coverage assumption.` },
    { key: "momentum", label: "Pipeline momentum", value: momentum, weight: 14, explain: stalled === 0 ? "No deals are past their stage's normal dwell time." : `${stalled} of ${openDeals.length} open deals are past their stage's normal dwell time.` },
    { key: "discipline", label: "Follow-up discipline", value: discipline, weight: 12, explain: overdueTasks === 0 ? "Nothing is overdue." : `${overdueTasks} of ${totalTasks} open tasks are overdue.` },
    { key: "response", label: "Response rate", value: responseRate, weight: 12, explain: sent > 0 ? `${replied} inbound replies against ${sent} messages sent in 30 days.` : "Nothing sent in the last 30 days." },
    { key: "conversion", label: "Conversion rate", value: conversion, weight: 12, explain: wonCount + lostCount > 0 ? `${wonCount} won and ${lostCount} lost in the last 30 days.` : "No deals closed either way in 30 days — not enough data." },
    { key: "aging", label: "Deal aging", value: aging, weight: 10, explain: `Open deals average ${Math.round(avgAgeDays)} days in their current stage.` },
    { key: "intent", label: "Buyer intent", value: intentHealth, weight: 10, explain: `${hotLeads} of ${allLeads} active leads are hot or buying.` },
    { key: "next_steps", label: "Next-step hygiene", value: nextStepHealth, weight: 8, explain: dealsNoNext === 0 ? "Every open deal has a scheduled next action." : `${dealsNoNext} open deals have no next action scheduled.` },
    { key: "concentration", label: "Opportunity spread", value: concentration, weight: 4, explain: pipelineInr > 0 ? `Largest deal is ${Math.round((largest / pipelineInr) * 100)}% of open pipeline.` : "No open pipeline to assess." },
    { key: "meetings", label: "Meeting conversion", value: meetingConversion, weight: 4, explain: replied > 0 ? `${meetings} meetings from ${replied} replies in 30 days.` : "No replies to convert yet." },
  ];

  const weightTotal = dimensions.reduce((s, d) => s + d.weight, 0);
  const score = Math.round(dimensions.reduce((s, d) => s + d.value * d.weight, 0) / weightTotal);

  const weakest = [...dimensions].sort((a, b) => a.value - b.value).slice(0, 3);

  return {
    score,
    band: score >= 80 ? "strong" : score >= 60 ? "healthy" : score >= 40 ? "needs work" : "at risk",
    dimensions,
    weakest: weakest.map((d) => ({ label: d.label, value: d.value, explain: d.explain })),
    stageCount: stages,
  };
}

// --------------------------------------------------------------------------
// §11 — revenue in motion.
// --------------------------------------------------------------------------

export async function getRevenueInMotion(ctx: AuthContext, days: number) {
  const since = new Date(Date.now() - days * DAY);
  const ownerScope = leadVisibilityFilter(ctx).ownerId
    ? { ownerId: leadVisibilityFilter(ctx).ownerId }
    : {};

  const [created, history, won, lost, stages] = await Promise.all([
    db.deal.aggregate({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, createdAt: { gte: since }, ...ownerScope },
      _sum: { valueInr: true },
      _count: true,
    }),
    db.dealStageHistory.findMany({
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: {
        dealId: true,
        valueAtMove: true,
        createdAt: true,
        fromStageId: true,
        toStageId: true,
        toStage: { select: { sortOrder: true } },
      },
    }),
    db.deal.aggregate({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "WON", wonAt: { gte: since }, ...ownerScope },
      _sum: { valueInr: true },
      _count: true,
    }),
    db.deal.aggregate({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "LOST", lostAt: { gte: since }, ...ownerScope },
      _sum: { valueInr: true },
      _count: true,
    }),
    db.pipelineStage.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true, sortOrder: true, isWon: true, isLost: true },
    }),
  ]);

  const order = new Map(stages.map((st) => [st.id, st.sortOrder]));
  const net = netMovement(history, order);
  const advancedInr = net.forwardInr;
  const advancedCount = net.forwardCount;
  const regressedInr = net.backwardInr;
  const regressedCount = net.backwardCount;

  const stalledDeals = await db.deal.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      status: "OPEN",
      ...ownerScope,
      risks: { some: { resolvedAt: null, code: "stage_stalled" } },
    },
    select: { valueInr: true },
  });

  return toPlain({
    days,
    entered: { inr: Number(created._sum.valueInr ?? 0), count: created._count },
    advanced: { inr: advancedInr, count: advancedCount },
    stalled: {
      inr: stalledDeals.reduce((s, d) => s + Number(d.valueInr), 0),
      count: stalledDeals.length,
    },
    regressed: { inr: regressedInr, count: regressedCount },
    won: { inr: Number(won._sum.valueInr ?? 0), count: won._count },
    lost: { inr: Number(lost._sum.valueInr ?? 0), count: lost._count },
  });
}

// --------------------------------------------------------------------------
// §12 — 14-day activity heatmap.
// --------------------------------------------------------------------------

const HEATMAP_KINDS: { key: string; label: string; match: (kind: string) => boolean }[] = [
  { key: "outreach", label: "Outreach", match: (k) => k === "message.sent" },
  { key: "replies", label: "Replies", match: (k) => k === "message.replied" },
  { key: "calls", label: "Calls", match: (k) => k === "call.logged" },
  { key: "meetings", label: "Meetings", match: (k) => k === "meeting.booked" },
  { key: "leads", label: "New leads", match: (k) => k === "lead.surfaced" },
  { key: "signals", label: "Signals", match: (k) => k === "signal.detected" },
  { key: "deals", label: "Deals moved", match: (k) => k === "deal.stage_changed" },
  { key: "proposals", label: "Proposals", match: (k) => k === "proposal.viewed" },
  { key: "tasks", label: "Tasks done", match: (k) => k === "task.completed" },
];

export async function getActivityHeatmap(ctx: AuthContext, days = 14) {
  const since = new Date(Date.now() - days * DAY);
  since.setHours(0, 0, 0, 0);

  const activities = await db.activity.findMany({
    where: { workspaceId: ctx.workspaceId, occurredAt: { gte: since } },
    select: { kind: true, occurredAt: true },
  });

  const buckets = new Map<string, Record<string, number>>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * DAY);
    buckets.set(dateKey(d), Object.fromEntries(HEATMAP_KINDS.map((k) => [k.key, 0])));
  }

  for (const a of activities) {
    const key = dateKey(a.occurredAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    for (const kind of HEATMAP_KINDS) {
      if (kind.match(a.kind)) bucket[kind.key]++;
    }
  }

  const rows = HEATMAP_KINDS.map((kind) => ({
    key: kind.key,
    label: kind.label,
    cells: [...buckets.entries()].map(([date, counts]) => ({ date, value: counts[kind.key] })),
  }));

  const max = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.value)));

  return { days, rows, max, dates: [...buckets.keys()] };
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// --------------------------------------------------------------------------
// §13, §44, §16
// --------------------------------------------------------------------------

export async function getCoachTip(ctx: AuthContext) {
  const insight = await db.aIInsight.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      kind: "COACH_TIP",
      dismissedAt: null,
      OR: [{ forUserId: ctx.userId }, { forUserId: null }],
    },
    orderBy: { createdAt: "desc" },
  });
  return insight
    ? toPlain({
        id: insight.id,
        title: insight.title,
        body: insight.body,
        whyNow: insight.whyNow,
        evidence: insight.evidence,
        confidence: insight.confidence,
        createdAt: insight.createdAt,
      })
    : null;
}

export async function getDailyBriefInsight(ctx: AuthContext) {
  const insight = await db.aIInsight.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      kind: "DAILY_BRIEF",
      dismissedAt: null,
      OR: [{ forUserId: ctx.userId }, { forUserId: null }],
    },
    orderBy: { createdAt: "desc" },
  });
  return insight
    ? toPlain({
        id: insight.id,
        title: insight.title,
        body: insight.body,
        evidence: insight.evidence,
        createdAt: insight.createdAt,
      })
    : null;
}

export async function getAutopilotDigest(ctx: AuthContext) {
  const since = new Date(Date.now() - DAY);

  const runs = await db.agentRun.findMany({
    where: { workspaceId: ctx.workspaceId, startedAt: { gte: since } },
    include: {
      agent: { select: { name: true, kind: true } },
      actions: { orderBy: { sequence: "asc" } },
    },
    orderBy: { startedAt: "desc" },
  });

  if (runs.length === 0) return null;

  const allActions = runs.flatMap((r) => r.actions);
  const pointsSpent = runs.reduce((s, r) => s + r.pointsSpent, 0);
  const needsReview = allActions.filter((a) => a.requiresApproval && a.state === "pending_approval");

  const [leadsFound, revealed, sent, drafted] = [
    allActions.filter((a) => a.tool === "find_leads" || a.tool === "add_lead").length,
    allActions.filter((a) => a.tool === "unlock_contacts").length,
    allActions.filter((a) => a.tool.startsWith("send_") && a.state === "completed").length,
    allActions.filter((a) => a.tool === "draft_outreach").length,
  ];

  return toPlain({
    runCount: runs.length,
    mode: ctx.workspace.autopilotMode,
    leadsFound,
    contactsRevealed: revealed,
    messagesDrafted: drafted,
    messagesSent: sent,
    pointsSpent,
    needsReviewCount: needsReview.length,
    lastRunAt: runs[0].startedAt,
    log: runs.flatMap((r) =>
      r.actions.map((a) => ({
        id: a.id,
        at: a.occurredAt,
        agent: r.agent.name,
        tool: a.tool,
        riskClass: a.riskClass,
        summary: a.summary,
        state: a.state,
        pointsSpent: a.pointsSpent,
        requiresApproval: a.requiresApproval,
      }))
    ),
  });
}

export async function getStickyNotes(ctx: AuthContext) {
  const notes = await db.stickyNote.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      authorId: ctx.userId,
      archivedAt: null,
      deletedAt: null,
    },
    orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
    take: 8,
  });
  return toPlain(
    notes.map((n) => ({
      id: n.id,
      kind: n.kind,
      body: n.body,
      color: n.color,
      isPinned: n.isPinned,
      updatedAt: n.updatedAt,
    }))
  );
}
