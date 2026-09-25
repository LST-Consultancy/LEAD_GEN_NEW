import { readsReplies } from "./mailboxes";
import "server-only";
import { sendingReady } from "./mailbox-sending";
import { db } from "@/lib/db";
import { type AuthContext, leadVisibilityFilter } from "@/lib/auth/context";
import { toPlain } from "@/lib/serialize";
import { activeEmailProvider } from "@/lib/outreach/provider";

/**
 * The Inbox is the one screen where the product's honesty problem is sharpest:
 * with no mailbox connected, no new mail can arrive. Rather than showing an
 * empty shell, it shows the real conversation history that exists in the
 * workspace and states plainly that nothing new will land until a mailbox is
 * connected.
 */

export type InboxFilter = "needs_you" | "waiting" | "open" | "snoozed" | "closed" | "all" | "unread";

/**
 * Conversations are scoped by the *lead's* owner, not by an assignee, so inbox
 * visibility matches lead visibility exactly. A rep who cannot see a lead must
 * not see its thread — which would otherwise be a way around row-level
 * visibility.
 */
function visibilityWhere(ctx: AuthContext) {
  const filter = leadVisibilityFilter(ctx);
  if (!filter.ownerId) return {};
  return {
    OR: [
      { lead: { ownerId: filter.ownerId } },
      // Threads with no lead attached are visible to their assignee only.
      { AND: [{ leadId: null }, { assigneeId: filter.ownerId }] },
    ],
  };
}

const STATE_FOR: Record<Exclude<InboxFilter, "all" | "unread">, string> = {
  needs_you: "NEEDS_YOU",
  waiting: "WAITING",
  open: "OPEN",
  snoozed: "SNOOZED",
  closed: "CLOSED",
};

export async function listConversations(
  ctx: AuthContext,
  opts: { filter?: InboxFilter; channel?: string; search?: string; limit?: number } = {}
) {
  const filter = opts.filter ?? "needs_you";
  const where = {
    workspaceId: ctx.workspaceId,
    deletedAt: null,
    ...visibilityWhere(ctx),
    ...(filter === "unread"
      ? { isUnread: true }
      : filter === "all"
        ? {}
        : { state: STATE_FOR[filter] as never }),
    ...(opts.channel ? { channel: opts.channel as never } : {}),
    ...(opts.search
      ? {
          OR: [
            { subject: { contains: opts.search, mode: "insensitive" as const } },
            { company: { name: { contains: opts.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const rows = await db.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: opts.limit ?? 50,
    include: {
      company: { select: { id: true, name: true, industry: true, logoUrl: true } },
      lead: {
        select: {
          id: true,
          tier: true,
          intent: true,
          ownerId: true,
          repliedAt: true,
          person: { select: { fullName: true, avatarUrl: true } },
          score: { select: { composite: true } },
        },
      },
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, direction: true, body: true, state: true, createdAt: true },
      },
      _count: { select: { messages: { where: { deletedAt: null } } } },
    },
  });

  return rows.map((c) => {
    const last = c.messages[0] ?? null;
    return {
      id: c.id,
      channel: c.channel,
      subject: c.subject,
      state: c.state,
      isUnread: c.isUnread,
      aiSummary: c.aiSummary,
      sentiment: c.sentiment,
      lastMessageAt: c.lastMessageAt.toISOString(),
      snoozedUntil: c.snoozedUntil?.toISOString() ?? null,
      assigneeId: c.assigneeId,
      messageCount: c._count.messages,
      company: c.company,
      lead: c.lead
        ? {
            id: c.lead.id,
            tier: c.lead.tier,
            intent: c.lead.intent,
            name: c.lead.person.fullName,
            avatarUrl: c.lead.person.avatarUrl,
            score: c.lead.score ? Number(c.lead.score.composite) : null,
            hasReplied: c.lead.repliedAt !== null,
          }
        : null,
      lastMessage: last
        ? {
            direction: last.direction,
            state: last.state,
            // A one-line preview; the full body is on the detail view.
            preview: last.body.replace(/\s+/g, " ").trim().slice(0, 180),
            at: last.createdAt.toISOString(),
          }
        : null,
    };
  });
}

/** Counts for the filter rail. Computed in SQL, one round trip. */
export async function getInboxCounts(ctx: AuthContext) {
  const base = { workspaceId: ctx.workspaceId, deletedAt: null, ...visibilityWhere(ctx) };
  const grouped = await db.conversation.groupBy({
    by: ["state"],
    where: base,
    _count: { _all: true },
  });
  const unread = await db.conversation.count({ where: { ...base, isUnread: true } });
  const byState = new Map(grouped.map((g) => [g.state, g._count._all]));

  return {
    needs_you: byState.get("NEEDS_YOU") ?? 0,
    waiting: byState.get("WAITING") ?? 0,
    open: byState.get("OPEN") ?? 0,
    snoozed: byState.get("SNOOZED") ?? 0,
    closed: byState.get("CLOSED") ?? 0,
    all: grouped.reduce((n, g) => n + g._count._all, 0),
    unread,
  };
}

export async function getConversation(ctx: AuthContext, id: string) {
  const replies = await readsReplies(ctx.workspaceId);
  const conversation = await db.conversation.findFirst({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null, ...visibilityWhere(ctx) },
    include: {
      company: { select: { id: true, name: true, industry: true, city: true, employeeCount: true } },
      deal: { select: { id: true, title: true, valueInr: true, status: true } },
      lead: {
        select: {
          id: true,
          tier: true,
          intent: true,
          status: true,
          repliedAt: true,
          lastContactedAt: true,
          person: {
            select: {
              fullName: true,
              avatarUrl: true,
              employments: {
                where: { isCurrent: true },
                select: { title: true },
                take: 1,
              },
            },
          },
          score: { select: { composite: true } },
        },
      },
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: {
          sequenceStep: {
            select: { stepOrder: true, sequence: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!conversation) return null;

  // Whether a reply could actually be sent, surfaced next to the composer so
  // the button never lies about what it will do.
  const provider = activeEmailProvider();

  return {
    ...toPlain({
      id: conversation.id,
      channel: conversation.channel,
      subject: conversation.subject,
      state: conversation.state,
      isUnread: conversation.isUnread,
      aiSummary: conversation.aiSummary,
      sentiment: conversation.sentiment,
      lastMessageAt: conversation.lastMessageAt,
      snoozedUntil: conversation.snoozedUntil,
      assigneeId: conversation.assigneeId,
      company: conversation.company,
      deal: conversation.deal,
    }),
    lead: conversation.lead
      ? {
          id: conversation.lead.id,
          tier: conversation.lead.tier,
          intent: conversation.lead.intent,
          status: conversation.lead.status,
          name: conversation.lead.person.fullName,
          avatarUrl: conversation.lead.person.avatarUrl,
          title: conversation.lead.person.employments[0]?.title ?? null,
          score: conversation.lead.score ? Number(conversation.lead.score.composite) : null,
          repliedAt: conversation.lead.repliedAt?.toISOString() ?? null,
          lastContactedAt: conversation.lead.lastContactedAt?.toISOString() ?? null,
        }
      : null,
    messages: conversation.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      channel: m.channel,
      state: m.state,
      fromAddress: m.fromAddress,
      toAddress: m.toAddress,
      subject: m.subject,
      body: m.body,
      actorType: m.actorType,
      generatedByAi: m.generatedByAi,
      aiModel: m.aiModel,
      failureReason: m.failureReason,
      sentAt: m.sentAt?.toISOString() ?? null,
      readAt: m.readAt?.toISOString() ?? null,
      bouncedAt: m.bouncedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      fromSequence: m.sequenceStep
        ? {
            sequenceId: m.sequenceStep.sequence.id,
            name: m.sequenceStep.sequence.name,
            stepOrder: m.sequenceStep.stepOrder,
          }
        : null,
    })),
    sending: {
      configured: await sendingReady(ctx.workspaceId),
      provider,
      canReceive: replies,
    },
  };
}

/**
 * The state of the mailbox connection, for the banner at the top of the Inbox.
 * Kept here so every surface tells the same story.
 */
export async function getMailboxStatus(ctx: AuthContext) {
  const replies = await readsReplies(ctx.workspaceId);
  const [pendingApproval, queued, failed, lastInbound] = await Promise.all([
    db.message.count({
      where: { workspaceId: ctx.workspaceId, state: "PENDING_APPROVAL", deletedAt: null },
    }),
    db.message.count({ where: { workspaceId: ctx.workspaceId, state: "QUEUED", deletedAt: null } }),
    db.message.count({
      where: { workspaceId: ctx.workspaceId, state: { in: ["FAILED", "BOUNCED"] }, deletedAt: null },
    }),
    db.message.findFirst({
      where: { workspaceId: ctx.workspaceId, direction: "INBOUND", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    configured: await sendingReady(ctx.workspaceId),
    provider: activeEmailProvider(),
    canReceive: replies,
    pendingApproval,
    queued,
    failed,
    lastInboundAt: lastInbound?.createdAt.toISOString() ?? null,
  };
}
