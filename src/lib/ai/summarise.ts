import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { visibilityWhereForConversation } from "@/lib/services/inbox-scope";
import { complete } from "@/lib/ai/complete";

/**
 * §51 — summarising a conversation.
 *
 * The case for this feature is narrow and real: coming back to a thread after
 * three weeks, the question is "where did we leave this and what did they
 * actually ask for", and scrolling a dozen messages to answer it is the tax.
 *
 * The case against a bad version is worse: a summary that invents a commitment
 * — a price, a date, an agreement — gets acted on, because a summary is read as
 * fact. So it summarises only what is in the messages, and says when a thread
 * is too short to be worth summarising rather than padding.
 */

export type SummaryResult =
  | {
      ok: true;
      text: string;
      /** How many messages it read, so the reader can judge the summary's basis. */
      messageCount: number;
      model: string;
      costInr: number;
    }
  | { ok: false; code: SummaryFailure; reason: string };

export type SummaryFailure = "not_found" | "too_short" | "provider_unavailable";

/** Below this, reading the thread is faster than reading a summary of it. */
const MIN_MESSAGES = 4;

const SYSTEM = `You summarise a B2B sales email thread for the salesperson who owns it.

Rules:
- Only state what is in the messages. Never infer a price, a date, a decision or
  a commitment that nobody wrote down. A summary is read as fact and acted on.
- Attribute clearly: say who said what. "They asked" and "we said" are the two
  things the reader needs separated.
- Lead with where it stands now, then what they are waiting on, then what was
  agreed. Skip anything that has since been superseded.
- If the thread contains no question, no commitment and no decision, say that
  plainly in one sentence rather than describing pleasantries.
- Four sentences at most. Plain Indian English, no preamble.`;

export async function summariseThread(
  ctx: AuthContext,
  conversationId: string
): Promise<SummaryResult> {
  const conversation = await db.conversation.findFirst({
    // The same visibility rule the Inbox itself uses, so a summary can never
    // reveal a thread the caller could not open.
    where: { id: conversationId, ...visibilityWhereForConversation(ctx) },
    include: {
      lead: { select: { person: { select: { fullName: true } } } },
      company: { select: { name: true } },
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: 40,
        select: {
          direction: true,
          subject: true,
          body: true,
          createdAt: true,
          state: true,
        },
      },
    },
  });

  if (!conversation) {
    return {
      ok: false,
      code: "not_found",
      reason: "That conversation doesn't exist, or you don't have access to it.",
    };
  }

  // Only messages that were actually exchanged. A queued or failed one was
  // never seen by anyone, and summarising it as if it had been is a lie the
  // reader would act on.
  const exchanged = conversation.messages.filter(
    (m) => m.direction === "INBOUND" || ["SENT", "DELIVERED", "READ", "REPLIED"].includes(m.state)
  );

  if (exchanged.length < MIN_MESSAGES) {
    return {
      ok: false,
      code: "too_short",
      reason: `This thread has ${exchanged.length} ${exchanged.length === 1 ? "message" : "messages"}. Reading it is faster than summarising it, so nothing was generated or charged.`,
    };
  }

  const who = conversation.lead?.person.fullName ?? conversation.company?.name ?? "the prospect";

  const prompt = [
    `THREAD with ${who}${conversation.company ? ` at ${conversation.company.name}` : ""}`,
    conversation.subject ? `SUBJECT: ${conversation.subject}` : "",
    "",
    "MESSAGES, oldest first:",
    ...exchanged.map(
      (m) =>
        `[${m.direction === "INBOUND" ? "THEM" : "US"}, ${m.createdAt.toDateString()}] ${m.body.slice(0, 1200)}`
    ),
    "",
    "Summarise it.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const completion = await complete(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    { feature: "summarise_thread", system: SYSTEM, prompt, maxTokens: 1500, timeoutMs: 30_000 }
  );

  if (!completion.ok) {
    return { ok: false, code: "provider_unavailable", reason: completion.reason };
  }

  return {
    ok: true,
    text: completion.text.trim(),
    messageCount: exchanged.length,
    model: completion.model,
    costInr: completion.estimatedCostInr,
  };
}
