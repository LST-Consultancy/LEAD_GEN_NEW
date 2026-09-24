import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { dealVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPaise, toRupees } from "@/lib/proposals/money";
import { MutationError, loadScoped, mutate } from "./mutate";

/**
 * Money after the win: what was invoiced, what was paid, what is still owed.
 *
 * Won is not paid. A won deal with nothing invoiced is *unbilled*, and an
 * invoice with nothing received is *outstanding* — three different numbers a
 * founder reads differently, so none of them is inferred from another.
 *
 * Entries are never edited or deleted. A mistake is corrected with an
 * adjustment carrying a reason, so the record of what was said to a customer
 * stays intact. All arithmetic is in integer paise.
 */

export const MONEY_KIND = ["invoice", "payment", "adjustment"] as const;
type Kind = (typeof MONEY_KIND)[number];

const entrySchema = z.object({
  kind: z.enum(MONEY_KIND),
  amountInr: z.number().finite(),
  reference: z.string().trim().max(80).optional(),
  /** Invoice: when it is due. Payment: when it was received. */
  date: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
}).superRefine((v, c) => {
  if (v.kind !== "adjustment" && v.amountInr <= 0) c.addIssue({ code: "custom", path: ["amountInr"], message: "An invoice or payment must be more than zero." });
  if (v.kind === "adjustment" && v.amountInr === 0) c.addIssue({ code: "custom", path: ["amountInr"], message: "An adjustment of zero changes nothing." });
  if (v.kind === "adjustment" && !v.note) c.addIssue({ code: "custom", path: ["note"], message: "Say why the figure is being corrected." });
});

type Row = { kind: string; amountInr: unknown };
/** Paise totals for a set of entries. Adjustments correct the invoiced figure. */
function sums(rows: Row[]) {
  let invoiced = 0; let paid = 0;
  for (const r of rows) {
    const p = toPaise(Number(r.amountInr));
    if (r.kind === "invoice" || r.kind === "adjustment") invoiced += p;
    else if (r.kind === "payment") paid += p;
  }
  return { invoiced, paid };
}

async function scopedDeal(ctx: AuthContext, dealId: string) {
  return loadScoped(() => db.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId, deletedAt: null, ...dealVisibilityFilter(ctx) }, select: { id: true, title: true, status: true, valueInr: true, leadId: true, companyId: true } }), "That deal");
}

export async function getDealMoney(ctx: AuthContext, dealId: string) {
  const deal = await scopedDeal(ctx, dealId);
  const entries = await db.moneyEntry.findMany({ where: { dealId, workspaceId: ctx.workspaceId }, orderBy: { createdAt: "asc" } });
  const { invoiced, paid } = sums(entries);
  const won = toPaise(Number(deal.valueInr));
  return {
    dealStatus: deal.status,
    wonInr: toRupees(won),
    invoicedInr: toRupees(invoiced),
    paidInr: toRupees(paid),
    outstandingInr: toRupees(invoiced - paid),
    unbilledInr: deal.status === "WON" ? toRupees(Math.max(0, won - invoiced)) : null,
    entries: entries.map((e) => ({ id: e.id, kind: e.kind as Kind, amountInr: Number(e.amountInr), reference: e.reference, date: (e.kind === "payment" ? e.settledAt : e.dueAt)?.toISOString() ?? null, note: e.note, createdAt: e.createdAt.toISOString() })),
  };
}

export async function recordMoney(ctx: AuthContext, dealId: string, raw: z.input<typeof entrySchema>) {
  const input = entrySchema.parse(raw);
  const deal = await scopedDeal(ctx, dealId);
  if (deal.status !== "WON") throw new MutationError("Invoices and payments are recorded against won deals. Mark it won first.", "not_won", 409);
  const existing = await db.moneyEntry.findMany({ where: { dealId, workspaceId: ctx.workspaceId }, select: { kind: true, amountInr: true } });
  const { invoiced, paid } = sums(existing);
  const amount = toPaise(input.amountInr);
  if (input.kind === "payment" && paid + amount > invoiced) {
    throw new MutationError(`That payment is more than is outstanding (₹${toRupees(invoiced - paid).toLocaleString("en-IN")}). Record the invoice first, or check the amount.`, "overpayment", 422);
  }
  if (input.kind === "adjustment" && invoiced + amount < paid) {
    throw new MutationError("That adjustment would leave less invoiced than has already been paid.", "below_paid", 422);
  }
  if (input.reference && input.kind !== "adjustment") {
    const dup = await db.moneyEntry.findFirst({ where: { workspaceId: ctx.workspaceId, kind: input.kind, reference: input.reference }, select: { id: true } });
    if (dup) throw new MutationError(`An ${input.kind} with reference ${input.reference} is already recorded.`, "duplicate_reference", 409);
  }

  return mutate(ctx, PERMISSIONS.PIPELINE_EDIT, async () => {
    const entry = await db.moneyEntry.create({
      data: {
        workspaceId: ctx.workspaceId, dealId, kind: input.kind, amountInr: toRupees(amount), reference: input.reference ?? null, note: input.note ?? null,
        ...(input.kind === "payment" ? { settledAt: input.date } : { dueAt: input.date }),
      },
    });
    const label = input.kind === "invoice" ? "Invoiced" : input.kind === "payment" ? "Payment received" : "Invoiced amount adjusted";
    return {
      result: { id: entry.id },
      log: {
        action: `deal.money.${input.kind}`, objectType: "Deal", objectId: dealId,
        after: { kind: input.kind, amountInr: toRupees(amount), reference: input.reference ?? null, note: input.note ?? null },
        activity: { kind: `deal.${input.kind}`, summary: `${label}: ₹${toRupees(amount).toLocaleString("en-IN")} on ${deal.title}`, dealId, leadId: deal.leadId ?? undefined, companyId: deal.companyId, amountInr: toRupees(amount) },
      },
    };
  });
}

/** Across the won deals this person can see. Overdue = an invoice past its due date while money is still owed on that deal. */
export async function getCashSummary(ctx: AuthContext) {
  const deals = await db.deal.findMany({ where: { workspaceId: ctx.workspaceId, deletedAt: null, status: "WON", ...dealVisibilityFilter(ctx) }, select: { id: true, valueInr: true, money: { select: { kind: true, amountInr: true, dueAt: true } } } });
  let won = 0; let invoiced = 0; let paid = 0; let unbilled = 0; let overdueDeals = 0;
  const now = Date.now();
  for (const d of deals) {
    const s = sums(d.money);
    const w = toPaise(Number(d.valueInr));
    won += w; invoiced += s.invoiced; paid += s.paid; unbilled += Math.max(0, w - s.invoiced);
    if (s.invoiced > s.paid && d.money.some((m) => m.kind === "invoice" && m.dueAt && m.dueAt.getTime() < now)) overdueDeals++;
  }
  return { wonDeals: deals.length, wonInr: toRupees(won), invoicedInr: toRupees(invoiced), collectedInr: toRupees(paid), outstandingInr: toRupees(invoiced - paid), unbilledInr: toRupees(unbilled), overdueDeals };
}
