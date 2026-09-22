import "server-only";
import { db } from "@/lib/db";
import { formatInrCompact } from "@/lib/format";

const DAY = 86_400_000;

/**
 * §113 — recomputes the ranked next-best-action list.
 *
 * Deliberately rule-based rather than model-generated: every option carries a
 * rationale the user can check, and the ranking is reproducible. When an AI
 * provider is wired up it can add candidates, but it will not replace these,
 * because a recommendation nobody can audit is not actionable.
 */
export async function refreshNextBestActions(workspaceId: string, leadIds?: string[]) {
  const now = Date.now();

  const leads = await db.lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      discardedAt: null,
      archivedAt: null,
      ...(leadIds?.length ? { id: { in: leadIds } } : {}),
    },
    select: {
      id: true,
      intent: true,
      tier: true,
      status: true,
      repliedAt: true,
      lastContactedAt: true,
      estimatedBudgetInr: true,
      score: {
        select: { composite: true, reachabilityScore: true, budgetScore: true, authorityScore: true },
      },
      person: { select: { contactMethods: { select: { isLocked: true, value: true, optedOutAt: true } } } },
      company: { select: { _count: { select: { employments: true } } } },
      deals: {
        where: { status: "OPEN", deletedAt: null },
        select: { valueInr: true, nextActionAt: true, stage: { select: { probability: true } } },
      },
      proposals: { select: { viewCount: true, state: true } },
      signals: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true, title: true } },
    },
    take: leadIds?.length ? undefined : 2_000,
  });

  let written = 0;

  for (const lead of leads) {
    const candidates: {
      action: string;
      label: string;
      rationale: string;
      score: number;
      channel: "EMAIL" | "PHONE" | "WHATSAPP" | null;
    }[] = [];

    const contacts = lead.person.contactMethods.filter((c) => !c.optedOutAt);
    const reachableNow = contacts.some((c) => !c.isLocked);
    const revealable = contacts.some((c) => c.isLocked && c.value !== null);
    const openDeal = lead.deals[0];
    const proposalViews = lead.proposals.reduce((s, p) => s + p.viewCount, 0);
    const freshSignalDays = lead.signals[0]
      ? (now - lead.signals[0].occurredAt.getTime()) / DAY
      : null;

    if (lead.repliedAt) {
      candidates.push({
        action: "reply_now",
        label: "Reply now",
        rationale: `They replied ${Math.round((now - lead.repliedAt.getTime()) / 3_600_000)} hours ago and are waiting. Reply latency is the strongest single predictor of losing a deal you were winning.`,
        score: 95,
        channel: "EMAIL",
      });
      candidates.push({
        action: "book_meeting",
        label: "Send a booking link",
        rationale: "A positive reply converts best when it becomes a calendar slot the same day.",
        score: 80,
        channel: "EMAIL",
      });
    }

    if (proposalViews >= 3 && !lead.repliedAt) {
      candidates.push({
        action: "call_about_proposal",
        label: "Call about the proposal",
        rationale: `Your proposal has been opened ${proposalViews} times with no reply. Repeated opens without a response usually mean internal circulation, or a price objection nobody has said out loud.`,
        score: 88,
        channel: "PHONE",
      });
    }

    if (!lead.lastContactedAt && (lead.score?.composite ?? 0) >= 60 && freshSignalDays !== null && freshSignalDays <= 14) {
      candidates.push({
        action: "contact_now",
        label: "Contact now",
        rationale: `Strong fit with a signal ${Math.round(freshSignalDays)} days old and no outreach yet. The first credible response usually gets the meeting.`,
        score: 86,
        channel: reachableNow ? "EMAIL" : null,
      });
    }

    if (revealable && !reachableNow && (lead.score?.composite ?? 0) >= 55) {
      candidates.push({
        action: "reveal_contact",
        label: "Reveal a contact",
        rationale:
          "The score is high enough to act on but there is no usable channel yet. One point unlocks a verified route in.",
        score: 74,
        channel: null,
      });
    }

    if (openDeal && !openDeal.nextActionAt) {
      candidates.push({
        action: "set_next_step",
        label: "Agree a dated next step",
        rationale: `${formatInrCompact(Number(openDeal.valueInr))} is open with nothing scheduled to move it. This is the most common way a live deal goes quiet.`,
        score: 84,
        channel: null,
      });
    }

    if ((lead.score?.budgetScore ?? 0) < 30 && (lead.repliedAt || lead.lastContactedAt)) {
      candidates.push({
        action: "qualify_budget",
        label: "Qualify the budget",
        rationale:
          "Budget is the largest unknown holding this score down. One direct question resolves it either way.",
        score: 58,
        channel: "PHONE",
      });
    }

    if ((lead.score?.authorityScore ?? 0) < 45 && lead.company._count.employments > 1) {
      candidates.push({
        action: "add_stakeholder",
        label: "Find the decision maker",
        rationale:
          "Your contact is unlikely to be able to sign. Deals that stay single-threaded at this size routinely stall at procurement.",
        score: 52,
        channel: null,
      });
    }

    if (candidates.length === 0) {
      const why =
        freshSignalDays === null
          ? "Nothing indicates a live project — they matched your ICP on attributes, not behaviour."
          : `The most recent signal is ${Math.round(freshSignalDays)} days old and nothing suggests urgency.`;
      candidates.push({
        action: "wait",
        label: "Wait for a stronger signal",
        rationale: `${why} Contacting now spends credibility cheaply.`,
        score: 40,
        channel: null,
      });
      candidates.push({
        action: "watch",
        label: "Add to Radar",
        rationale: "Worth monitoring rather than contacting.",
        score: 35,
        channel: null,
      });
    }

    const ranked = candidates.sort((a, b) => b.score - a.score).slice(0, 4);

    // Replaced wholesale, so a stale recommendation can never outlive its reason.
    await db.$transaction(async (tx) => {
      await tx.nextBestAction.deleteMany({ where: { leadId: lead.id } });
      await tx.nextBestAction.createMany({
        data: ranked.map((c, i) => ({
          workspaceId,
          leadId: lead.id,
          action: c.action,
          label: c.label,
          rationale: c.rationale,
          rank: i,
          score: c.score,
          channel: c.channel,
          expectedImpactInr: openDeal
            ? openDeal.valueInr
            : (lead.estimatedBudgetInr ?? null),
        })),
      });
    });
    written += ranked.length;
  }

  return { workspaceId, leadsConsidered: leads.length, actionsWritten: written };
}

/**
 * §76 — raises notifications for what became urgent since the last sweep.
 *
 * Deduplicated on the object it refers to, so a recurring sweep does not
 * re-notify the same thing every fifteen minutes.
 */
export async function sweepNotifications(workspaceId: string) {
  const now = new Date();
  const since = new Date(now.getTime() - 26 * 3_600_000);

  const members = await db.workspaceMember.findMany({
    where: { workspaceId, deletedAt: null },
    select: { userId: true },
  });
  if (members.length === 0) return { workspaceId, raised: 0 };

  let raised = 0;

  /** Writes a notification unless an equivalent one already exists today. */
  async function notifyOnce(
    userId: string,
    kind: Parameters<typeof db.notification.create>[0]["data"]["kind"],
    key: string,
    data: { title: string; body: string; severity: string; href: string; leadId?: string; dealId?: string }
  ) {
    const existing = await db.notification.findFirst({
      where: {
        workspaceId,
        userId,
        kind,
        createdAt: { gte: since },
        ...(data.leadId ? { leadId: data.leadId } : {}),
        ...(data.dealId ? { dealId: data.dealId } : {}),
        title: data.title,
      },
    });
    if (existing) return;
    await db.notification.create({
      data: {
        workspaceId,
        userId,
        kind,
        title: data.title,
        body: data.body,
        severity: data.severity,
        href: data.href,
        leadId: data.leadId ?? null,
        dealId: data.dealId ?? null,
      },
    });
    raised++;
    void key;
  }

  // Newly hot Tier A/B leads.
  const hot = await db.lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      archivedAt: null,
      tier: { in: ["A", "B"] },
      intent: { in: ["HOT", "BUYING"] },
      signals: { some: { detectedAt: { gte: since } } },
    },
    select: {
      id: true,
      ownerId: true,
      person: { select: { fullName: true } },
      company: { select: { name: true } },
      score: { select: { displayScore: true } },
      signals: { orderBy: { occurredAt: "desc" }, take: 1, select: { title: true } },
    },
    take: 50,
  });

  for (const lead of hot) {
    const targets = lead.ownerId ? [lead.ownerId] : members.map((m) => m.userId);
    for (const userId of targets) {
      await notifyOnce(userId, "HOT_LEAD", `hot:${lead.id}`, {
        title: `${lead.person.fullName} is showing strong intent`,
        body: `${lead.signals[0]?.title ?? "New signal detected"} · ${lead.company.name} · ${Number(lead.score?.displayScore ?? 0)}/10`,
        severity: "info",
        href: `/leads/${lead.id}`,
        leadId: lead.id,
      });
    }
  }

  // Deals that just picked up a high-severity flag.
  const atRisk = await db.deal.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: "OPEN",
      risks: { some: { resolvedAt: null, severity: "high", detectedAt: { gte: since } } },
    },
    select: {
      id: true,
      title: true,
      valueInr: true,
      ownerId: true,
      risks: {
        where: { resolvedAt: null, severity: "high" },
        take: 1,
        select: { title: true, explanation: true },
      },
    },
    take: 50,
  });

  for (const deal of atRisk) {
    const targets = deal.ownerId ? [deal.ownerId] : members.map((m) => m.userId);
    for (const userId of targets) {
      await notifyOnce(userId, "DEAL_RISK", `risk:${deal.id}`, {
        title: `${formatInrCompact(Number(deal.valueInr))} deal at risk`,
        body: `${deal.title} — ${deal.risks[0]?.title ?? "flagged"}`,
        severity: "warning",
        href: "/pipeline",
        dealId: deal.id,
      });
    }
  }

  // Points running low, judged against actual burn rate rather than a fixed number.
  const head = await db.pointLedger.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });
  if (head) {
    const spends = await db.pointLedger.findMany({
      where: { workspaceId, delta: { lt: 0 }, createdAt: { gte: new Date(now.getTime() - 14 * DAY) } },
      select: { delta: true },
    });
    const perDay = spends.reduce((s, r) => s + Math.abs(r.delta), 0) / 14;
    const daysLeft = perDay > 0 ? Math.floor(head.balanceAfter / perDay) : null;

    if (daysLeft !== null && daysLeft < 7) {
      const owners = await db.workspaceMember.findMany({
        where: { workspaceId, deletedAt: null, role: { key: { in: ["owner", "admin"] } } },
        select: { userId: true },
      });
      for (const { userId } of owners) {
        await notifyOnce(userId, "POINTS_LOW", "points", {
          title: "Points running low",
          body: `${head.balanceAfter} left. At ${Math.round(perDay)} a day that is about ${daysLeft} days.`,
          severity: "warning",
          href: "/settings/billing",
        });
      }
    }
  }

  return { workspaceId, raised };
}
