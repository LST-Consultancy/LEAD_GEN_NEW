import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { loadScoped, mutate, MutationError } from "./mutate";
import { toPlain } from "@/lib/serialize";
import { emitWebhookEvent } from "@/lib/services/webhook-events";

const scopedLead = (ctx: AuthContext, leadId: string) =>
  loadScoped(
    () => db.lead.findFirst({ where: { id: leadId, workspaceId: ctx.workspaceId, deletedAt: null, ...leadVisibilityFilter(ctx) }, include: { person: { select: { fullName: true } } } }),
    "That lead"
  );

export const touchSchema = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP", "LINKEDIN", "PHONE", "SMS", "IN_PERSON"]),
  direction: z.enum(["OUTBOUND", "INBOUND"]).default("OUTBOUND"),
  outcome: z.enum(["sent", "connected", "no_answer", "voicemail", "wrong_number", "replied", "meeting_agreed", "not_interested"]).optional(),
  note: z.string().trim().max(2000).optional(),
  occurredAt: z.coerce.date().optional(),
});

const OUTCOME_LABEL: Record<string, string> = {
  sent: "sent", connected: "connected", no_answer: "no answer", voicemail: "left voicemail", wrong_number: "wrong number",
  replied: "replied", meeting_agreed: "agreed to meet", not_interested: "not interested",
};
const CHANNEL_WORD: Record<string, string> = { EMAIL: "Email", WHATSAPP: "WhatsApp", LINKEDIN: "LinkedIn message", PHONE: "Call", SMS: "SMS", IN_PERSON: "Meeting in person" };

/**
 * Records a touch that happened outside the product: an email sent from the
 * rep's own client, a call, a WhatsApp from their phone. Nothing is sent from
 * here. An inbound reply marks the lead replied, which is what stops any
 * sequence set to stop on reply — the send engine reads the same field.
 */
export async function logTouch(ctx: AuthContext, leadId: string, raw: z.input<typeof touchSchema>) {
  const input = touchSchema.parse(raw);
  const lead = await scopedLead(ctx, leadId);
  const at = input.occurredAt ?? new Date();
  if (at.getTime() > Date.now() + 5 * 60_000) throw new MutationError("A touch can't be logged in the future. Use a task or reminder for something planned.", "future_touch", 422);
  const replied = input.direction === "INBOUND" || input.outcome === "replied" || input.outcome === "meeting_agreed";

  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const stopped = await db.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          lastActivityAt: at,
          ...(input.direction === "OUTBOUND" && (!lead.lastContactedAt || lead.lastContactedAt < at) ? { lastContactedAt: at } : {}),
          ...(replied && !lead.repliedAt ? { repliedAt: at } : {}),
        },
      });
      if (!replied) return 0;
      const { count } = await tx.sequenceEnrollment.updateMany({
        where: { workspaceId: ctx.workspaceId, leadId: lead.id, state: "active", sequence: { stopOnReply: true } },
        data: { state: "replied", repliedAt: at, nextSendAt: null, stopReason: "Reply logged by hand" },
      });
      return count;
    });
    // Logged by hand; a connected mailbox records replies itself with loggedByHand: false.
    if (replied) await emitWebhookEvent(ctx.workspaceId, "message.replied", { leadId: lead.id, channel: input.channel, occurredAt: at.toISOString(), loggedByHand: true, sequencesStopped: stopped });
    const verb = input.direction === "INBOUND" ? `${CHANNEL_WORD[input.channel]} reply from` : `${CHANNEL_WORD[input.channel]} to`;
    const summary = `${verb} ${lead.person.fullName}${input.outcome ? ` — ${OUTCOME_LABEL[input.outcome]}` : ""}`;
    return {
      result: { leadId: lead.id, replied, sequencesStopped: stopped },
      log: {
        action: "lead.touch_logged",
        objectType: "Lead",
        objectId: lead.id,
        after: { channel: input.channel, direction: input.direction, outcome: input.outcome ?? null, occurredAt: at.toISOString(), sequencesStopped: stopped },
        activity: { kind: input.direction === "INBOUND" ? "touch.inbound" : "touch.outbound", summary, detail: input.note, leadId: lead.id, companyId: lead.companyId, channel: input.channel, metadata: { outcome: input.outcome ?? null, loggedByHand: true } },
      },
    };
  });
}

export const recommendationSchema = z.object({
  decision: z.enum(["chosen", "rejected"]),
  feedback: z.string().trim().max(400).optional(),
});

/** "Do it" and "Not this" on a next best action, stored rather than toasted. */
export async function decideRecommendation(ctx: AuthContext, actionId: string, raw: z.input<typeof recommendationSchema>) {
  const input = recommendationSchema.parse(raw);
  const nba = await loadScoped(
    () => db.nextBestAction.findFirst({ where: { id: actionId, workspaceId: ctx.workspaceId, OR: [{ leadId: null }, { lead: { deletedAt: null, ...leadVisibilityFilter(ctx) } }] } }),
    "That recommendation"
  );
  return mutate(ctx, PERMISSIONS.LEADS_EDIT, async () => {
    const now = new Date();
    const updated = await db.nextBestAction.update({
      where: { id: nba.id },
      data: input.decision === "chosen" ? { chosenAt: now, rejectedAt: null, feedback: input.feedback ?? null } : { rejectedAt: now, chosenAt: null, feedback: input.feedback ?? null },
    });
    return {
      result: toPlain(updated),
      log: { action: `recommendation.${input.decision}`, objectType: "NextBestAction", objectId: nba.id, before: { chosenAt: nba.chosenAt, rejectedAt: nba.rejectedAt }, after: { decision: input.decision, feedback: input.feedback ?? null } },
    };
  });
}
