import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { toPlain } from "@/lib/serialize";

/**
 * §60 — proposal setup.
 *
 * There is no workspace-level defaults row: every proposal carries its own tax
 * rate, terms and validity. Rather than invent a defaults table that nothing
 * reads, this screen reports what your proposals *actually* use — which is the
 * honest answer to "what are my defaults?" and surfaces the inconsistencies a
 * settings page would otherwise hide.
 */

export type ProposalNorms = {
  total: number;
  /** Distinct tax rates in use, commonest first. More than one is worth seeing. */
  taxRates: { rate: number; count: number }[];
  /** How many carry a terms block at all. */
  withTerms: number;
  /** Median validity in days, or null when nothing sets one. */
  medianValidityDays: number | null;
  withoutValidity: number;
  /** The knowledge-base entries that actually govern commercial terms. */
  pricingDocs: { id: string; title: string; updatedAt: string }[];
};

export async function getProposalNorms(ctx: AuthContext): Promise<ProposalNorms> {
  const [proposals, pricingDocs] = await Promise.all([
    db.proposal.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: { taxRate: true, terms: true, validUntil: true, createdAt: true },
    }),
    db.knowledgeDoc.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, isActive: true, kind: "pricing" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true },
    }),
  ]);

  const rateCounts = new Map<number, number>();
  const validityDays: number[] = [];
  let withTerms = 0;
  let withoutValidity = 0;

  for (const p of proposals) {
    const rate = Number(p.taxRate);
    rateCounts.set(rate, (rateCounts.get(rate) ?? 0) + 1);
    if (p.terms && p.terms.trim().length > 0) withTerms++;
    if (p.validUntil) {
      // Whole days between issue and expiry, which is what a person sets.
      const days = Math.round((p.validUntil.getTime() - p.createdAt.getTime()) / 86_400_000);
      if (days > 0) validityDays.push(days);
    } else {
      withoutValidity++;
    }
  }

  validityDays.sort((a, b) => a - b);

  return {
    total: proposals.length,
    taxRates: [...rateCounts.entries()]
      .map(([rate, count]) => ({ rate, count }))
      .sort((a, b) => b.count - a.count),
    withTerms,
    withoutValidity,
    // Median rather than mean: one proposal left open for a year should not
    // move the figure that describes the normal case.
    medianValidityDays: validityDays.length
      ? validityDays[Math.floor(validityDays.length / 2)]
      : null,
    pricingDocs: toPlain(pricingDocs).map((d) => ({
      id: d.id,
      title: d.title,
      updatedAt: String(d.updatedAt),
    })),
  };
}
