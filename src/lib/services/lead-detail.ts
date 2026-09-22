import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { toPlain } from "@/lib/serialize";
import { DIMENSION_LABELS, type Dimension } from "@/lib/scoring";

/**
 * Everything the dossier needs, in one scoped query. Returns null rather than
 * throwing when the lead is out of tenant or out of the caller's visibility —
 * the route turns that into a 404, so a missing lead and a forbidden lead are
 * indistinguishable from outside.
 */
export async function getLeadDossier(ctx: AuthContext, leadId: string) {
  const lead = await db.lead.findFirst({
    where: {
      id: leadId,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...leadVisibilityFilter(ctx),
    },
    include: {
      person: {
        include: {
          employments: {
            where: { isCurrent: true },
            include: { company: { select: { id: true, name: true } } },
          },
          contactMethods: { orderBy: [{ isPrimary: "desc" }, { kind: "asc" }] },
          memory: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
        },
      },
      company: true,
      owner: { select: { id: true, name: true, avatarUrl: true, email: true } },
      icpProfile: { select: { id: true, name: true } },
      sourcePhrase: { select: { id: true, phrase: true, sourceKind: true } },
      score: { include: { evidence: { orderBy: [{ dimension: "asc" }, { points: "desc" }] } } },
      signals: { orderBy: { occurredAt: "desc" } },
      readiness: { orderBy: { sortOrder: "asc" } },
      nextBestActions: { orderBy: { rank: "asc" } },
      notes: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      },
      tasks: {
        where: { deletedAt: null, status: { not: "CANCELLED" } },
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        include: { owner: { select: { id: true, name: true } } },
      },
      deals: {
        where: { deletedAt: null },
        include: {
          stage: true,
          risks: { where: { resolvedAt: null } },
          owner: { select: { id: true, name: true } },
        },
      },
      conversations: {
        where: { deletedAt: null },
        orderBy: { lastMessageAt: "desc" },
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 6 },
          _count: { select: { messages: true } },
        },
      },
      proposals: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { views: true } } },
      },
      bookings: { where: { deletedAt: null }, orderBy: { startsAt: "desc" } },
      research: { orderBy: { startedAt: "desc" } },
      enrollments: { include: { sequence: { select: { id: true, name: true } } } },
      activities: { orderBy: { occurredAt: "desc" }, take: 40 },
      insights: { where: { dismissedAt: null }, orderBy: { createdAt: "desc" } },
      listMembers: { include: { list: { select: { id: true, name: true, color: true } } } },
    },
  });

  if (!lead) return null;

  // Reachable colleagues at the same company (§28), plus their committee role.
  const colleagues = await db.employment.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      companyId: lead.companyId,
      isCurrent: true,
      personId: { not: lead.personId },
    },
    include: {
      person: {
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
          linkedinUrl: true,
          contactMethods: { select: { kind: true, isLocked: true, status: true } },
          leads: {
            where: { workspaceId: ctx.workspaceId, deletedAt: null },
            select: { id: true, tier: true, score: { select: { displayScore: true } } },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ isDecisionMaker: "desc" }, { seniority: "asc" }],
  });

  const committee = await db.committeeMember.findMany({
    where: { workspaceId: ctx.workspaceId, companyId: lead.companyId },
    select: { personId: true, role: true, influence: true, confirmedAt: true, isAiSuggested: true },
  });
  const committeeByPerson = new Map(committee.map((c) => [c.personId, c]));

  const employment = lead.person.employments[0];
  const score = lead.score;

  // Group score evidence by dimension so the "Why?" panel can show a per-axis
  // breakdown rather than one flat list.
  type EvidenceRow = NonNullable<typeof score>["evidence"][number];
  const evidenceByDimension = new Map<Dimension, EvidenceRow[]>();
  for (const e of score?.evidence ?? []) {
    const key = e.dimension as Dimension;
    if (!evidenceByDimension.has(key)) evidenceByDimension.set(key, []);
    evidenceByDimension.get(key)!.push(e);
  }

  const dimensions = score
    ? (
        [
          ["fit", score.fitScore],
          ["intent", score.intentScore],
          ["urgency", score.urgencyScore],
          ["authority", score.authorityScore],
          ["budget", score.budgetScore],
          ["reachability", score.reachabilityScore],
          ["engagement", score.engagementScore],
          ["recency", score.recencyScore],
        ] as [Dimension, number][]
      ).map(([key, value]) => ({
        key,
        label: DIMENSION_LABELS[key].label,
        question: DIMENSION_LABELS[key].question,
        value,
        evidence: (evidenceByDimension.get(key) ?? []).map((e) => ({
          points: e.points,
          label: e.label,
          detail: e.detail,
          sourceType: e.sourceType,
          signalId: e.signalId,
        })),
      }))
    : [];

  const inboundCount = lead.conversations.reduce(
    (sum, c) => sum + c.messages.filter((m) => m.direction === "INBOUND").length,
    0
  );
  const outboundCount = lead.conversations.reduce(
    (sum, c) => sum + c.messages.filter((m) => m.direction === "OUTBOUND" && m.sentAt).length,
    0
  );

  return toPlain({
    id: lead.id,
    status: lead.status,
    tier: lead.tier,
    intent: lead.intent,
    isStarred: lead.isStarred,
    isRevealed: lead.isRevealed,
    isArchived: lead.archivedAt !== null,
    // Drives whether the header offers a reveal at all.
    lockedContactCount: lead.person.contactMethods.filter(
      (c) => c.isLocked && c.value !== null && c.optedOutAt === null
    ).length,
    estimatedBudgetInr: lead.estimatedBudgetInr,
    surfacedAt: lead.surfacedAt,
    surfacedReason: lead.surfacedReason,
    lastContactedAt: lead.lastContactedAt,
    lastActivityAt: lead.lastActivityAt,
    repliedAt: lead.repliedAt,
    nextActionAt: lead.nextActionAt,
    nextActionLabel: lead.nextActionLabel,
    createdAt: lead.createdAt,

    person: {
      id: lead.person.id,
      name: lead.person.fullName,
      firstName: lead.person.firstName,
      headline: lead.person.headline,
      avatarUrl: lead.person.avatarUrl,
      linkedinUrl: lead.person.linkedinUrl,
      location: [lead.person.city, lead.person.state].filter(Boolean).join(", "),
      languages: lead.person.languages,
      title: employment?.title ?? "—",
      department: employment?.department ?? null,
      seniority: employment?.seniority ?? null,
      isDecisionMaker: employment?.isDecisionMaker ?? false,
      startedAt: employment?.startedAt ?? null,
      memory: lead.person.memory.map((m) => ({
        id: m.id,
        kind: m.kind,
        content: m.content,
        sourceType: m.sourceType,
        confidence: m.confidence,
        createdAt: m.createdAt,
      })),
    },

    company: {
      id: lead.company.id,
      name: lead.company.name,
      legalName: lead.company.legalName,
      domain: lead.company.domain,
      website: lead.company.website,
      linkedinUrl: lead.company.linkedinUrl,
      logoUrl: lead.company.logoUrl,
      description: lead.company.description,
      industry: lead.company.industry,
      subIndustry: lead.company.subIndustry,
      employeeCount: lead.company.employeeCount,
      employeeBand: lead.company.employeeBand,
      revenueBandInr: lead.company.revenueBandInr,
      foundedYear: lead.company.foundedYear,
      location: [lead.company.city, lead.company.state].filter(Boolean).join(", "),
      technologies: lead.company.technologies,
      intentScore: lead.company.intentScore,
      intentScoreReason: lead.company.intentScoreReason,
      lastSignalAt: lead.company.lastSignalAt,
    },

    owner: lead.owner,
    icpProfile: lead.icpProfile,
    sourcePhrase: lead.sourcePhrase,
    lists: lead.listMembers.map((m) => m.list),

    scoring: score
      ? {
          displayScore: Number(score.overriddenScore ?? score.displayScore),
          rawScore: Number(score.displayScore),
          composite: score.composite,
          isOverridden: score.overriddenScore != null,
          overrideReason: score.overrideReason,
          computedAt: score.computedAt,
          modelVersion: score.modelVersion,
          dimensions,
        }
      : null,

    contacts: lead.person.contactMethods.map((c) => ({
      id: c.id,
      kind: c.kind,
      value: c.isLocked ? null : c.value,
      maskedValue: c.maskedValue,
      isLocked: c.isLocked,
      isPrimary: c.isPrimary,
      status: c.status,
      confidence: c.confidence,
      source: c.source,
      verifiedAt: c.verifiedAt,
      revealedAt: c.revealedAt,
      optedOutAt: c.optedOutAt,
      bounceCount: c.bounceCount,
    })),

    signals: lead.signals.map((s) => ({
      id: s.id,
      type: s.type,
      sourceKind: s.sourceKind,
      sourceName: s.sourceName,
      sourceUrl: s.sourceUrl,
      title: s.title,
      excerpt: s.excerpt,
      aiInterpretation: s.aiInterpretation,
      confidence: s.confidence,
      suggestedAction: s.suggestedAction,
      keywords: s.keywords,
      occurredAt: s.occurredAt,
      detectedAt: s.detectedAt,
    })),

    readiness: lead.readiness.map((r) => ({
      code: r.code,
      label: r.label,
      state: r.state,
      evidence: r.evidence,
    })),

    nextBestActions: lead.nextBestActions.map((a) => ({
      id: a.id,
      action: a.action,
      label: a.label,
      rationale: a.rationale,
      rank: a.rank,
      score: a.score,
      channel: a.channel,
      expectedImpactInr: a.expectedImpactInr,
      chosenAt: a.chosenAt,
    })),

    deals: lead.deals.map((d) => ({
      id: d.id,
      title: d.title,
      valueInr: d.valueInr,
      status: d.status,
      confidence: d.confidence,
      stage: { id: d.stage.id, name: d.stage.name, key: d.stage.key, probability: d.stage.probability },
      stageEnteredAt: d.stageEnteredAt,
      expectedCloseAt: d.expectedCloseAt,
      nextActionAt: d.nextActionAt,
      nextActionLabel: d.nextActionLabel,
      lostReason: d.lostReason,
      owner: d.owner,
      risks: d.risks.map((r) => ({
        code: r.code,
        severity: r.severity,
        title: r.title,
        explanation: r.explanation,
        suggestedAction: r.suggestedAction,
      })),
    })),

    conversations: lead.conversations.map((c) => ({
      id: c.id,
      channel: c.channel,
      subject: c.subject,
      state: c.state,
      isUnread: c.isUnread,
      aiSummary: c.aiSummary,
      sentiment: c.sentiment,
      lastMessageAt: c.lastMessageAt,
      messageCount: c._count.messages,
      messages: c.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        channel: m.channel,
        state: m.state,
        subject: m.subject,
        body: m.body,
        generatedByAi: m.generatedByAi,
        sentAt: m.sentAt,
        readAt: m.readAt,
        createdAt: m.createdAt,
      })),
    })),

    proposals: lead.proposals.map((p) => ({
      id: p.id,
      title: p.title,
      state: p.state,
      totalInr: p.totalInr,
      sentAt: p.sentAt,
      firstViewedAt: p.firstViewedAt,
      lastViewedAt: p.lastViewedAt,
      viewCount: p.viewCount,
      validUntil: p.validUntil,
    })),

    bookings: lead.bookings.map((b) => ({
      id: b.id,
      title: b.title,
      state: b.state,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      meetingUrl: b.meetingUrl,
      agenda: b.agenda,
      aiSummary: b.aiSummary,
      outcomes: b.outcomes,
    })),

    research: lead.research.map((r) => ({
      id: r.id,
      depth: r.depth,
      state: r.state,
      pointsSpent: r.pointsSpent,
      confidence: r.confidence,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    })),

    enrollments: lead.enrollments.map((e) => ({
      id: e.id,
      sequence: e.sequence,
      state: e.state,
      currentStep: e.currentStep,
      nextSendAt: e.nextSendAt,
      stopReason: e.stopReason,
    })),

    notes: lead.notes.map((n) => ({
      id: n.id,
      body: n.body,
      author: n.author,
      isPinned: n.isPinned,
      createdAt: n.createdAt,
    })),

    tasks: lead.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt,
      priorityScore: t.priorityScore,
      priorityReason: t.priorityReason,
      recommendedAction: t.recommendedAction,
      channel: t.channel,
      owner: t.owner,
      createdByAi: t.createdByAi,
    })),

    insights: lead.insights.map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      body: i.body,
      whyNow: i.whyNow,
      severity: i.severity,
      evidence: i.evidence,
      confidence: i.confidence,
    })),

    activities: lead.activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      summary: a.summary,
      detail: a.detail,
      actorType: a.actorType,
      channel: a.channel,
      amountInr: a.amountInr,
      occurredAt: a.occurredAt,
    })),

    colleagues: colleagues.map((e) => {
      const c = committeeByPerson.get(e.person.id);
      const methods = e.person.contactMethods;
      const emails = methods.filter((m) => m.kind === "WORK_EMAIL" || m.kind === "PERSONAL_EMAIL");
      return {
        personId: e.person.id,
        name: e.person.fullName,
        avatarUrl: e.person.avatarUrl,
        linkedinUrl: e.person.linkedinUrl,
        title: e.title,
        department: e.department,
        seniority: e.seniority,
        isDecisionMaker: e.isDecisionMaker,
        committeeRole: c?.role ?? null,
        committeeConfirmed: c?.confirmedAt != null,
        committeeAiSuggested: c?.isAiSuggested ?? false,
        influence: c?.influence ?? null,
        contactState:
          emails.length === 0 ? "none" : emails.some((m) => !m.isLocked) ? "open" : "locked",
        leadId: e.person.leads[0]?.id ?? null,
        leadTier: e.person.leads[0]?.tier ?? null,
        leadScore: e.person.leads[0]?.score?.displayScore
          ? Number(e.person.leads[0].score.displayScore)
          : null,
      };
    }),

    engagement: { inboundCount, outboundCount },
  });
}

export type LeadDossier = NonNullable<Awaited<ReturnType<typeof getLeadDossier>>>;
