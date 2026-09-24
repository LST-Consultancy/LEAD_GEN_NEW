import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { MutationError } from "@/lib/services/mutate";
import { recordActivity, recordExternalAudit } from "@/lib/services/audit";
import { computeTotals, reconcile, isExpired, daysUntilExpiry } from "@/lib/proposals/money";
import { raiseNotification } from "@/lib/services/notify";
import { emitWebhookEvent } from "@/lib/services/webhook-events";

/**
 * The prospect-facing proposal.
 *
 * Unauthenticated, reached only by an unguessable token. Everything here runs
 * without an `AuthContext`, so the token *is* the authorisation — which means
 * every query must be keyed on it and nothing may be returned that the token
 * does not entitle the holder to see. No lead score, no internal notes, no
 * other proposal.
 */

/** What the prospect is allowed to see. Deliberately narrow. */
export type PublicProposal = {
  id: string;
  title: string;
  state: string;
  company: { name: string };
  workspace: { name: string; logoUrl: string | null; contact: { email: string | null; phone: string | null; website: string | null; address: string | null } | null };
  currency: string;
  subtotalInr: number;
  taxRate: number;
  taxInr: number;
  totalInr: number;
  items: {
    name: string;
    description: string | null;
    quantity: number;
    unit: string;
    unitPriceInr: number;
    amountInr: number;
  }[];
  sections: unknown;
  terms: string | null;
  validUntil: string | null;
  daysUntilExpiry: number | null;
  expired: boolean;
  acceptedAt: string | null;
  declinedAt: string | null;
  /** Whether the accept and decline buttons should do anything. */
  canDecide: boolean;
  /** Why not, when they cannot. */
  cannotDecideBecause: string | null;
};

/** Hash an IP rather than storing it — the count is the point, not the person. */
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

async function loadByToken(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  return db.proposal.findFirst({
    where: { publicToken: token, deletedAt: null },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      company: { select: { name: true } },
      workspace: { select: { id: true, name: true, logoUrl: true, timezone: true, proposalDefaults: { select: { logoDataUrl: true, contactEmail: true, contactPhone: true, website: true, address: true } } } },
    },
  });
}

export async function getPublicProposal(token: string): Promise<PublicProposal | null> {
  const p = await loadByToken(token);
  if (!p) return null;

  // A draft has a token but is not published. Treat it as absent rather than
  // as forbidden, so a guessed token cannot confirm that a draft exists.
  if (p.state === "DRAFT" || !p.sentAt) return null;

  const tz = p.workspace.timezone;
  const expired = isExpired(p.validUntil, new Date(), tz);
  const decided = p.acceptedAt !== null || p.declinedAt !== null;

  const items = p.items.map((i) => ({
    name: i.name,
    description: i.description,
    quantity: Number(i.quantity),
    unit: i.unit,
    unitPriceInr: Number(i.unitPriceInr),
    amountInr: Number(i.amountInr),
  }));

  // Recomputed for display. If the stored figures ever disagree with the
  // lines, the prospect sees the arithmetic of the lines in front of them —
  // never a total that does not add up.
  const recomputed = computeTotals(items, Number(p.taxRate));
  const stored = {
    subtotalInr: Number(p.subtotalInr),
    taxRate: Number(p.taxRate),
    taxInr: Number(p.taxInr),
    totalInr: Number(p.totalInr),
  };
  const trustworthy = reconcile(items, stored).ok;

  return {
    id: p.id,
    title: p.title,
    state: expired && !decided ? "EXPIRED" : p.state,
    company: { name: p.company.name },
    // Branding is read live (a new logo shows on old proposals); price and terms are the proposal's own.
    workspace: {
      name: p.workspace.name,
      logoUrl: p.workspace.proposalDefaults?.logoDataUrl ?? p.workspace.logoUrl,
      contact: p.workspace.proposalDefaults ? { email: p.workspace.proposalDefaults.contactEmail, phone: p.workspace.proposalDefaults.contactPhone, website: p.workspace.proposalDefaults.website, address: p.workspace.proposalDefaults.address } : null,
    },
    currency: p.currency,
    ...(trustworthy ? stored : recomputed),
    items,
    sections: p.sections,
    terms: p.terms,
    validUntil: p.validUntil?.toISOString() ?? null,
    daysUntilExpiry: daysUntilExpiry(p.validUntil, new Date(), tz),
    expired,
    acceptedAt: p.acceptedAt?.toISOString() ?? null,
    declinedAt: p.declinedAt?.toISOString() ?? null,
    canDecide: !decided && !expired,
    cannotDecideBecause: decided
      ? p.acceptedAt
        ? "This proposal has already been accepted."
        : "This proposal has already been declined."
      : expired
        ? "This proposal has passed its validity date. Ask your contact to extend it."
        : null,
  };
}

/**
 * Records that the proposal was opened.
 *
 * `isOwnTeam` is passed by the route, which knows whether the reader has a
 * session in the owning workspace. A seller refreshing their own proposal must
 * not inflate the count the seller then reads as buyer interest — that would
 * turn the most useful signal on the screen into noise.
 */
export async function recordProposalView(
  token: string,
  meta: { ip: string | null; userAgent: string | null; isOwnTeam: boolean }
): Promise<{ recorded: boolean; reason?: string }> {
  const p = await loadByToken(token);
  if (!p || p.state === "DRAFT" || !p.sentAt) return { recorded: false, reason: "not_published" };

  if (meta.isOwnTeam) {
    return { recorded: false, reason: "own_team" };
  }

  const ipHash = hashIp(meta.ip);
  const now = new Date();

  // Collapse a burst from the same reader: a page load that fires twice, or a
  // refresh a few seconds later, is one view of one proposal.
  if (ipHash) {
    const recent = await db.proposalView.findFirst({
      where: {
        proposalId: p.id,
        ipHash,
        viewedAt: { gte: new Date(now.getTime() - 60_000) },
      },
      select: { id: true },
    });
    if (recent) return { recorded: false, reason: "duplicate_within_a_minute" };
  }

  await db.$transaction([
    db.proposalView.create({
      data: {
        workspaceId: p.workspaceId,
        proposalId: p.id,
        viewedAt: now,
        ipHash,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
    }),
    db.proposal.update({
      where: { id: p.id },
      data: {
        viewCount: { increment: 1 },
        firstViewedAt: p.firstViewedAt ?? now,
        lastViewedAt: now,
        // SENT → VIEWED. Never downgrade a decided proposal.
        ...(p.state === "SENT" ? { state: "VIEWED" } : {}),
      },
    }),
  ]);

  await emitWebhookEvent(p.workspaceId, "proposal.viewed", { proposalId: p.id, firstView: !p.firstViewedAt });
  return { recorded: true };
}

const publicDecisionSchema = z.object({
  decision: z.enum(["accept", "decline"]),
  /** Who is answering. Free text, because we cannot verify it either way. */
  byName: z.string().trim().min(2, "Please give the name you are answering under.").max(120),
  reason: z.string().trim().max(1000).optional(),
});

/**
 * The prospect accepting or declining.
 *
 * Audited as an `INTEGRATION`-sourced action by an external actor, because it
 * is the one write in the product that a person outside the workspace can
 * make. The name they give is recorded as *claimed*, not verified — the audit
 * entry says so, since a link holder is not an authenticated party.
 */
export async function decidePublicProposal(
  token: string,
  raw: z.input<typeof publicDecisionSchema>
) {
  const input = publicDecisionSchema.parse(raw);
  const p = await loadByToken(token);

  if (!p || p.state === "DRAFT" || !p.sentAt) {
    throw new MutationError("That proposal is not available.", "not_found", 404);
  }
  if (p.acceptedAt || p.declinedAt) {
    throw new MutationError(
      `This proposal was already ${p.acceptedAt ? "accepted" : "declined"}. Contact ${p.workspace.name} if that is wrong.`,
      "already_decided",
      409
    );
  }
  if (isExpired(p.validUntil, new Date(), p.workspace.timezone)) {
    throw new MutationError(
      "This proposal has passed its validity date, so it can no longer be accepted. Ask your contact to extend it.",
      "expired",
      410
    );
  }
  if (input.decision === "decline" && !input.reason) {
    throw new MutationError(
      "Please say briefly why, so we do not follow up on something settled.",
      "reason_required",
      422
    );
  }

  const now = new Date();
  const updated = await db.proposal.update({
    where: { id: p.id },
    data:
      input.decision === "accept"
        ? { state: "ACCEPTED", acceptedAt: now }
        : { state: "DECLINED", declinedAt: now },
  });

  await recordExternalAudit(p.workspaceId, {
    action:
      input.decision === "accept"
        ? "proposal.accepted_by_recipient"
        : "proposal.declined_by_recipient",
    objectType: "Proposal",
    objectId: p.id,
    before: { state: p.state },
    after: {
      state: updated.state,
      claimedName: input.byName,
      reason: input.reason ?? null,
      // Stated explicitly: the app cannot verify who clicked a link.
      identityVerified: false,
    },
    claimedBy: input.byName,
    via: "proposal link",
  });

  await recordActivity(
    { workspaceId: p.workspaceId, userId: null },
    {
      kind: input.decision === "accept" ? "proposal.accepted" : "proposal.declined",
      summary:
        input.decision === "accept"
          ? `${p.company.name} accepted "${p.title}"`
          : `${p.company.name} declined "${p.title}" — ${input.reason}`,
      // The claimed name lives in the detail, since Activity has no actor
      // label and the summary should not imply a verified identity.
      detail: `Answered through the proposal link as "${input.byName}". That name is what the reader typed; it is not a verified identity.`,
      actorType: "SYSTEM",
      leadId: p.leadId ?? undefined,
      amountInr: Number(p.totalInr),
    }
  );

  if (input.decision === "accept") await emitWebhookEvent(p.workspaceId, "proposal.accepted", { proposalId: p.id, totalInr: Number(p.totalInr), via: "link", claimedName: input.byName });

  // Notifications are per-user, so this goes to whoever is accountable for the
  // proposal: its author, or the lead's owner if it has no author.
  const notify = p.createdById ?? (await ownerOfLead(p.leadId));
  if (notify) {
    await raiseNotification({
      data: {
        workspaceId: p.workspaceId,
        userId: notify,
        kind: input.decision === "accept" ? "PROPOSAL_ACCEPTED" : "PROPOSAL_DECLINED",
        severity: input.decision === "accept" ? "success" : "warning",
        title:
          input.decision === "accept"
            ? `${p.company.name} accepted your proposal`
            : `${p.company.name} declined your proposal`,
        body:
          input.decision === "accept"
            ? `Answered as "${input.byName}" through the proposal link. That name is what the reader typed, not a verified identity.`
            : `Answered as "${input.byName}": ${input.reason}`,
        href: "/proposals",
        leadId: p.leadId,
      },
    });
  }

  return {
    decision: input.decision,
    note:
      input.decision === "accept"
        ? `Thank you. ${p.workspace.name} has been notified.`
        : `Thank you for letting us know. ${p.workspace.name} has been notified.`,
  };
}

async function ownerOfLead(leadId: string | null): Promise<string | null> {
  if (!leadId) return null;
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { ownerId: true } });
  return lead?.ownerId ?? null;
}
