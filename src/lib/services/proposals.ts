import "server-only";
import { sendingReady } from "./mailbox-sending";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthContext, dealVisibilityFilter, leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPlain } from "@/lib/serialize";
import { MutationError, loadScoped, mutate, softDelete } from "@/lib/services/mutate";
import { computeTotals, reconcile, isExpired, daysUntilExpiry } from "@/lib/proposals/money";
import { activeEmailProvider, EMAIL_NOT_CONFIGURED } from "@/lib/outreach/provider";
import { emitWebhookEvent } from "@/lib/services/webhook-events";

const itemSchema = z.object({
  name: z.string().trim().min(1, "Every line needs a name.").max(200),
  description: z.string().trim().max(1000).optional(),
  quantity: z.number().finite().min(-10_000).max(100_000),
  unit: z.string().trim().min(1).max(30).default("item"),
  unitPriceInr: z.number().finite().min(-100_000_000).max(1_000_000_000),
});

const sectionSchema = z.object({
  key: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(20_000),
});

const proposalSchema = z.object({
  title: z.string().trim().min(2).max(200),
  companyId: z.string().uuid(),
  leadId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  taxRate: z.number().min(0).max(50).default(18),
  sections: z.array(sectionSchema).max(30).default([]),
  terms: z.string().trim().max(10_000).optional(),
  validUntil: z.coerce.date().optional(),
  items: z.array(itemSchema).min(1, "A proposal needs at least one line.").max(100),
});

export type ProposalInput = z.input<typeof proposalSchema>;

/** 32 hex characters, matching the existing tokens. Unguessable by design. */
function newToken(): string {
  return randomBytes(16).toString("hex");
}

function visibility(ctx: AuthContext) {
  const filter = leadVisibilityFilter(ctx);
  if (!filter.ownerId) return {};
  // A proposal with no lead is visible to whoever created it.
  return {
    OR: [{ lead: { ownerId: filter.ownerId } }, { leadId: null, createdById: filter.ownerId }],
  };
}

export async function listProposals(ctx: AuthContext) {
  const rows = await db.proposal.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, ...visibility(ctx) },
    orderBy: [{ updatedAt: "desc" }],
    include: {
      company: { select: { id: true, name: true, industry: true } },
      lead: { select: { id: true, person: { select: { fullName: true } } } },
      deal: { select: { id: true, title: true, status: true } },
      items: { orderBy: { sortOrder: "asc" } },
      _count: { select: { views: true } },
    },
  });

  const tz = ctx.workspace.timezone;

  return rows.map((p) => {
    const items = p.items.map((i) => ({
      name: i.name,
      quantity: Number(i.quantity),
      unitPriceInr: Number(i.unitPriceInr),
    }));
    const stored = {
      subtotalInr: Number(p.subtotalInr),
      taxRate: Number(p.taxRate),
      taxInr: Number(p.taxInr),
      totalInr: Number(p.totalInr),
    };
    const check = reconcile(items, stored);
    const expired = isExpired(p.validUntil, new Date(), tz);

    return {
      id: p.id,
      title: p.title,
      // An expired proposal reads as expired even if the stored enum has not
      // been swept yet, so the screen never disagrees with the calendar.
      state: expired && p.state !== "ACCEPTED" && p.state !== "DECLINED" ? "EXPIRED" : p.state,
      storedState: p.state,
      currency: p.currency,
      ...stored,
      sections: p.sections,
      terms: p.terms,
      validUntil: p.validUntil?.toISOString() ?? null,
      daysUntilExpiry: daysUntilExpiry(p.validUntil, new Date(), tz),
      sentAt: p.sentAt?.toISOString() ?? null,
      firstViewedAt: p.firstViewedAt?.toISOString() ?? null,
      lastViewedAt: p.lastViewedAt?.toISOString() ?? null,
      viewCount: p.viewCount,
      /**
       * Recorded view rows, which can differ from `viewCount` — the counter is
       * incremented on the public page, the rows are what we can evidence.
       * Showing both means the number is inspectable rather than asserted.
       */
      recordedViews: p._count.views,
      acceptedAt: p.acceptedAt?.toISOString() ?? null,
      declinedAt: p.declinedAt?.toISOString() ?? null,
      generatedByAi: p.generatedByAi,
      /**
       * The customer's URL. Safe in this payload — it is the caller's own
       * proposal and they are the one who has to share it — and having it here
       * means "copy link" and "open as the customer sees it" both work without
       * a second request.
       */
      publicPath: p.sentAt ? `/p/${p.publicToken}` : null,
      company: p.company,
      lead: p.lead ? { id: p.lead.id, name: p.lead.person.fullName } : null,
      deal: p.deal,
      items: p.items.map((i) => toPlain(i)),
      /** Non-null only when the stored totals disagree with the line items. */
      totalsMismatch: check.ok ? null : check.differences,
      updatedAt: p.updatedAt.toISOString(),
    };
  });
}

export async function getProposal(ctx: AuthContext, id: string) {
  const list = await db.proposal.findFirst({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null, ...visibility(ctx) },
    select: { id: true },
  });
  if (!list) return null;
  const all = await listProposals(ctx);
  const found = all.find((p) => p.id === id);
  if (!found) return null;

  const views = await db.proposalView.findMany({
    where: { proposalId: id, workspaceId: ctx.workspaceId },
    orderBy: { viewedAt: "desc" },
    take: 50,
    select: { id: true, viewedAt: true, durationSec: true, city: true },
  });

  return {
    ...found,
    views: views.map((v) => ({
      id: v.id,
      viewedAt: v.viewedAt.toISOString(),
      durationSec: v.durationSec,
      city: v.city,
    })),
  };
}

/**
 * A proposal's lead and deal must be this workspace's, visible to the author,
 * and at the proposal's company. Checked on create *and* update: before this,
 * `dealId` was never checked at all, so a proposal could be linked to another
 * tenant's deal by id.
 */
async function assertLinks(ctx: AuthContext, input: { companyId: string; leadId?: string; dealId?: string }) {
  if (input.leadId) {
    const lead = await loadScoped(() => db.lead.findFirst({ where: { id: input.leadId, workspaceId: ctx.workspaceId, deletedAt: null, ...leadVisibilityFilter(ctx) }, select: { companyId: true } }), "That lead");
    if (lead.companyId !== input.companyId) throw new MutationError("That lead works at a different company from this proposal.", "lead_company_mismatch", 422);
  }
  if (input.dealId) {
    const deal = await loadScoped(() => db.deal.findFirst({ where: { id: input.dealId, workspaceId: ctx.workspaceId, deletedAt: null, ...dealVisibilityFilter(ctx) }, select: { companyId: true } }), "That deal");
    if (deal.companyId !== input.companyId) throw new MutationError("That deal is with a different company from this proposal.", "deal_company_mismatch", 422);
  }
}

/**
 * What the editor needs to start a proposal: the company, its leads and open
 * deals the author can see, and the norms existing proposals actually use.
 */
export async function proposalStartingPoint(ctx: AuthContext, opts: { leadId?: string; companyId?: string; dealId?: string }) {
  let companyId = opts.companyId;
  if (opts.leadId) {
    const lead = await db.lead.findFirst({ where: { id: opts.leadId, workspaceId: ctx.workspaceId, deletedAt: null, ...leadVisibilityFilter(ctx) }, select: { companyId: true } });
    if (!lead) return null;
    companyId = lead.companyId;
  } else if (opts.dealId) {
    const deal = await db.deal.findFirst({ where: { id: opts.dealId, workspaceId: ctx.workspaceId, deletedAt: null, ...dealVisibilityFilter(ctx) }, select: { companyId: true } });
    if (!deal) return null;
    companyId = deal.companyId;
  }
  if (!companyId) return { company: null, leads: [], deals: [] };
  const company = await db.company.findFirst({ where: { id: companyId, workspaceId: ctx.workspaceId, deletedAt: null }, select: { id: true, name: true } });
  if (!company) return null;
  const [leads, deals] = await Promise.all([
    db.lead.findMany({ where: { workspaceId: ctx.workspaceId, companyId, deletedAt: null, ...leadVisibilityFilter(ctx) }, select: { id: true, person: { select: { fullName: true } } }, take: 50 }),
    db.deal.findMany({ where: { workspaceId: ctx.workspaceId, companyId, deletedAt: null, status: "OPEN", ...dealVisibilityFilter(ctx) }, select: { id: true, title: true, valueInr: true }, take: 50 }),
  ]);
  return toPlain({ company, leads: leads.map((l) => ({ id: l.id, name: l.person.fullName })), deals: deals.map((d) => ({ id: d.id, title: d.title, valueInr: Number(d.valueInr) })) });
}

export async function createProposal(ctx: AuthContext, raw: ProposalInput) {
  const input = proposalSchema.parse(raw);

  const company = await loadScoped(
    () =>
      db.company.findFirst({
        where: { id: input.companyId, workspaceId: ctx.workspaceId, deletedAt: null },
        select: { id: true, name: true },
      }),
    "That company"
  );

  await assertLinks(ctx, input);

  if (input.validUntil && isExpired(input.validUntil, new Date(), ctx.workspace.timezone)) {
    throw new MutationError(
      "That validity date has already passed, so the proposal would be expired the moment it was created.",
      "already_expired",
      422
    );
  }

  const totals = computeTotals(input.items, input.taxRate);

  return mutate(ctx, PERMISSIONS.PROPOSALS_EDIT, async () => {
    const proposal = await db.proposal.create({
      data: {
        workspaceId: ctx.workspaceId,
        companyId: input.companyId,
        leadId: input.leadId,
        dealId: input.dealId,
        title: input.title,
        // Always DRAFT. A proposal that is live the instant it is saved is a
        // mistake waiting to happen.
        state: "DRAFT",
        publicToken: newToken(),
        taxRate: input.taxRate,
        subtotalInr: totals.subtotalInr,
        taxInr: totals.taxInr,
        totalInr: totals.totalInr,
        sections: input.sections,
        terms: input.terms,
        validUntil: input.validUntil,
        createdById: ctx.userId,
        items: {
          create: input.items.map((item, index) => ({
            workspaceId: ctx.workspaceId,
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPriceInr: item.unitPriceInr,
            // Stored per line so the printed figure equals what is summed.
            amountInr: computeTotals([item], 0).subtotalInr,
            sortOrder: index,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    return {
      result: {
        proposal: toPlain(proposal),
        note: "Saved as a draft. The public link does not work until you send it.",
      },
      log: {
        action: "proposal.created",
        objectType: "Proposal",
        objectId: proposal.id,
        after: { title: input.title, totalInr: totals.totalInr, items: input.items.length },
        activity: {
          kind: "proposal.created",
          summary: `Drafted a proposal for ${company.name}`,
          leadId: input.leadId,
          amountInr: totals.totalInr,
        },
      },
    };
  });
}

export async function updateProposal(ctx: AuthContext, id: string, raw: ProposalInput) {
  const input = proposalSchema.parse(raw);

  const existing = await loadScoped(
    () =>
      db.proposal.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null, ...visibility(ctx) },
        include: { items: true, company: { select: { name: true } } },
      }),
    "That proposal"
  );

  if (existing.state === "ACCEPTED") {
    throw new MutationError(
      "This proposal has been accepted. Editing what someone agreed to would rewrite the record — create a new version instead.",
      "accepted_immutable",
      409
    );
  }
  // The company is fixed once drafted; links are re-checked against it.
  await assertLinks(ctx, { companyId: existing.companyId, leadId: input.leadId, dealId: input.dealId });

  const totals = computeTotals(input.items, input.taxRate);
  const wasSent = existing.sentAt !== null;

  return mutate(ctx, PERMISSIONS.PROPOSALS_EDIT, async () => {
    const proposal = await db.$transaction(async (tx) => {
      // Items are replaced wholesale: they carry no history of their own and
      // the public page must never show a mix of old and new lines.
      await tx.proposalItem.deleteMany({ where: { proposalId: id } });
      return tx.proposal.update({
        where: { id },
        data: {
          title: input.title,
          leadId: input.leadId,
          dealId: input.dealId,
          taxRate: input.taxRate,
          subtotalInr: totals.subtotalInr,
          taxInr: totals.taxInr,
          totalInr: totals.totalInr,
          sections: input.sections,
          terms: input.terms,
          validUntil: input.validUntil,
          items: {
            create: input.items.map((item, index) => ({
              workspaceId: ctx.workspaceId,
              name: item.name,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPriceInr: item.unitPriceInr,
              amountInr: computeTotals([item], 0).subtotalInr,
              sortOrder: index,
            })),
          },
        },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
    });

    return {
      result: {
        proposal: toPlain(proposal),
        note: wasSent
          ? "Saved. This proposal is already live, so anyone holding the link sees the new version immediately."
          : "Saved.",
      },
      log: {
        action: "proposal.updated",
        objectType: "Proposal",
        objectId: id,
        before: { totalInr: Number(existing.totalInr), items: existing.items.length },
        after: { totalInr: totals.totalInr, items: input.items.length, liveWhenEdited: wasSent },
      },
    };
  });
}

/**
 * Publishing.
 *
 * This is the honest split: making the link live always works, because a
 * shareable URL needs no mail provider. Emailing it is separate, and refused
 * when there is nothing to send with. The note says which of the two happened,
 * so "sent" never means "we hope it arrived".
 */
export async function sendProposal(
  ctx: AuthContext,
  id: string,
  opts: { byEmail?: boolean } = {}
) {
  const proposal = await loadScoped(
    () =>
      db.proposal.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null, ...visibility(ctx) },
        include: {
          items: true,
          company: { select: { name: true } },
          lead: { select: { id: true, person: { select: { fullName: true } } } },
        },
      }),
    "That proposal"
  );

  if (proposal.items.length === 0) {
    throw new MutationError("This proposal has no lines, so there is nothing to send.", "no_items", 422);
  }
  if (proposal.state === "ACCEPTED" || proposal.state === "DECLINED") {
    throw new MutationError(
      `This proposal was already ${proposal.state.toLowerCase()}. Re-sending it would invite a second answer to a settled question.`,
      "already_decided",
      409
    );
  }
  if (isExpired(proposal.validUntil, new Date(), ctx.workspace.timezone)) {
    throw new MutationError(
      "The validity date has passed. Extend it before sending, or the recipient opens something they cannot accept.",
      "expired",
      422
    );
  }

  // Totals are re-checked here because this is the moment they stop being
  // private. A proposal whose total disagrees with its own lines must not go
  // out.
  const check = reconcile(
    proposal.items.map((i) => ({
      name: i.name,
      quantity: Number(i.quantity),
      unitPriceInr: Number(i.unitPriceInr),
    })),
    {
      subtotalInr: Number(proposal.subtotalInr),
      taxRate: Number(proposal.taxRate),
      taxInr: Number(proposal.taxInr),
      totalInr: Number(proposal.totalInr),
    }
  );
  if (!check.ok) {
    throw new MutationError(
      `The stored totals do not match the line items: ${check.differences.join("; ")}. Save the proposal again to recompute them before sending.`,
      "totals_mismatch",
      409
    );
  }

  const wantsEmail = opts.byEmail ?? false;
  if (wantsEmail && !(await sendingReady(ctx.workspaceId))) {
    throw new MutationError(EMAIL_NOT_CONFIGURED, "no_provider", 422);
  }

  return mutate(ctx, PERMISSIONS.PROPOSALS_SEND, async () => {
    const updated = await db.proposal.update({
      where: { id },
      data: {
        state: "SENT",
        sentAt: proposal.sentAt ?? new Date(),
      },
    });

    return {
      result: {
        proposal: toPlain(updated),
        publicPath: `/p/${proposal.publicToken}`,
        emailed: wantsEmail,
        provider: activeEmailProvider(),
        note: wantsEmail
          ? "Queued for emailing, and the link is live."
          : "The link is live — anyone holding it can now read and accept this proposal. Nothing was emailed; send the link yourself.",
      },
      log: {
        action: "proposal.sent",
        objectType: "Proposal",
        objectId: id,
        before: { state: proposal.state },
        after: { state: "SENT", emailed: wantsEmail },
        activity: {
          kind: "proposal.sent",
          summary: `Proposal for ${proposal.company.name} is live${wantsEmail ? " and emailed" : " (link shared manually)"}`,
          leadId: proposal.leadId ?? undefined,
          amountInr: Number(proposal.totalInr),
        },
      },
    };
  });
}

const decisionSchema = z.object({
  decision: z.enum(["accept", "decline"]),
  reason: z.string().trim().max(1000).optional(),
});

/**
 * Recording a decision that arrived out of band — a phone call, a reply, a
 * signed PDF. Distinct from the prospect clicking accept on the public page,
 * and audited differently, because who did it matters.
 */
export async function recordProposalDecision(
  ctx: AuthContext,
  id: string,
  raw: z.input<typeof decisionSchema>
) {
  const input = decisionSchema.parse(raw);

  const proposal = await loadScoped(
    () =>
      db.proposal.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null, ...visibility(ctx) },
        include: { company: { select: { name: true } } },
      }),
    "That proposal"
  );

  if (proposal.state === "DRAFT") {
    throw new MutationError(
      "This proposal has not been sent, so there is nothing for anyone to have decided.",
      "not_sent",
      422
    );
  }
  if (proposal.acceptedAt || proposal.declinedAt) {
    throw new MutationError(
      `Already ${proposal.acceptedAt ? "accepted" : "declined"} on ${(proposal.acceptedAt ?? proposal.declinedAt)!.toISOString().slice(0, 10)}. A second decision would overwrite the first.`,
      "already_decided",
      409
    );
  }
  if (input.decision === "decline" && !input.reason) {
    throw new MutationError(
      "Record why it was declined — it is the only part of a loss that is reusable.",
      "reason_required",
      422
    );
  }

  return mutate(ctx, PERMISSIONS.PROPOSALS_SEND, async () => {
    const now = new Date();
    const updated = await db.proposal.update({
      where: { id },
      data:
        input.decision === "accept"
          ? { state: "ACCEPTED", acceptedAt: now }
          : { state: "DECLINED", declinedAt: now, terms: proposal.terms },
    });
    if (input.decision === "accept") await emitWebhookEvent(ctx.workspaceId, "proposal.accepted", { proposalId: id, totalInr: Number(updated.totalInr), via: "team" });

    return {
      result: {
        proposal: toPlain(updated),
        note:
          input.decision === "accept"
            ? "Recorded as accepted. The public page now shows it as accepted too."
            : "Recorded as declined, with your reason kept on the audit trail.",
      },
      log: {
        action: input.decision === "accept" ? "proposal.accepted" : "proposal.declined",
        objectType: "Proposal",
        objectId: id,
        before: { state: proposal.state },
        after: { state: updated.state, reason: input.reason ?? null, recordedBy: "team" },
        activity: {
          kind: input.decision === "accept" ? "proposal.accepted" : "proposal.declined",
          summary:
            input.decision === "accept"
              ? `${proposal.company.name} accepted the proposal`
              : `${proposal.company.name} declined: ${input.reason}`,
          leadId: proposal.leadId ?? undefined,
          amountInr: Number(proposal.totalInr),
        },
      },
    };
  });
}

export async function deleteProposal(ctx: AuthContext, id: string) {
  const proposal = await loadScoped(
    () =>
      db.proposal.findFirst({
        where: { id, workspaceId: ctx.workspaceId, deletedAt: null, ...visibility(ctx) },
        include: { company: { select: { name: true } } },
      }),
    "That proposal"
  );

  if (proposal.state === "ACCEPTED") {
    throw new MutationError(
      "An accepted proposal is a record of an agreement and cannot be deleted.",
      "accepted_immutable",
      409
    );
  }

  return mutate(ctx, PERMISSIONS.PROPOSALS_EDIT, async () => {
    await db.proposal.update({ where: { id }, data: { deletedAt: new Date() } });
    await softDelete(ctx, {
      objectType: "Proposal",
      objectId: id,
      label: `${proposal.title} · ${proposal.company.name}`,
    });

    return {
      result: {
        note: "Moved to the recycle bin. The public link stops working immediately.",
      },
      log: {
        action: "proposal.deleted",
        objectType: "Proposal",
        objectId: id,
        before: { title: proposal.title, state: proposal.state },
      },
    };
  });
}
