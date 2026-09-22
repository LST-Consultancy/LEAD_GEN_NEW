import "server-only";
import { db } from "@/lib/db";
import { isExpired, reconcile } from "@/lib/proposals/money";

/**
 * Moves proposals past their validity date into EXPIRED.
 *
 * The read paths already *display* an out-of-date proposal as expired, so this
 * job is not what makes the UI correct — it is what makes the stored state
 * agree with the calendar, so reporting and the public page do not depend on
 * whoever happens to load a screen.
 *
 * Idempotent: it only touches rows that are still live and already past their
 * date, and expiring one takes it out of the candidate set.
 */
export async function expireProposals(workspaceId: string) {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { timezone: true },
  });

  const candidates = await db.proposal.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      // Never touch something that was decided: an accepted proposal does not
      // expire, and a declined one is already settled.
      state: { in: ["SENT", "VIEWED"] },
      validUntil: { not: null },
    },
    select: { id: true, title: true, validUntil: true, createdById: true, leadId: true, company: { select: { name: true } } },
  });

  const due = candidates.filter((p) => isExpired(p.validUntil, new Date(), workspace.timezone));
  if (due.length === 0) return { expired: 0, notified: 0, mismatched: 0 };

  await db.proposal.updateMany({
    where: { id: { in: due.map((p) => p.id) } },
    data: { state: "EXPIRED" },
  });

  // Tell the owner, once. An expired proposal is a live opportunity that just
  // went quiet, which is worth a nudge rather than silence.
  let notified = 0;
  for (const p of due) {
    if (!p.createdById) continue;
    await db.notification.create({
      data: {
        workspaceId,
        userId: p.createdById,
        kind: "PROPOSAL_VIEWED",
        severity: "warning",
        title: `Proposal for ${p.company.name} has expired`,
        body: `"${p.title}" passed its validity date and can no longer be accepted from the link. Extend the date and re-send if it is still live.`,
        href: "/proposals",
        leadId: p.leadId,
      },
    });
    notified += 1;
  }

  return { expired: due.length, notified, mismatched: 0 };
}

/**
 * Checks every live proposal's stored totals against its own line items.
 *
 * This exists because the numbers are the product here: a proposal whose
 * total disagrees with its lines is worse than one that fails to load. The
 * send path already refuses to publish a mismatch, but a row can be corrupted
 * after it is sent — by a migration, a script, or a bug — and nobody would
 * know. This finds it and tells someone; it deliberately does **not** rewrite
 * the figures, because silently changing a price a customer has seen is worse
 * than the mismatch.
 */
export async function auditProposalTotals(workspaceId: string) {
  const proposals = await db.proposal.findMany({
    where: { workspaceId, deletedAt: null, state: { not: "DRAFT" } },
    include: {
      items: true,
      company: { select: { name: true } },
    },
  });

  const bad: { id: string; title: string; company: string; differences: string[]; createdById: string | null; leadId: string | null }[] = [];

  for (const p of proposals) {
    const check = reconcile(
      p.items.map((i) => ({
        name: i.name,
        quantity: Number(i.quantity),
        unitPriceInr: Number(i.unitPriceInr),
      })),
      {
        subtotalInr: Number(p.subtotalInr),
        taxRate: Number(p.taxRate),
        taxInr: Number(p.taxInr),
        totalInr: Number(p.totalInr),
      }
    );
    if (!check.ok) {
      bad.push({
        id: p.id,
        title: p.title,
        company: p.company.name,
        differences: check.differences,
        createdById: p.createdById,
        leadId: p.leadId,
      });
    }
  }

  let notified = 0;
  for (const p of bad) {
    if (!p.createdById) continue;
    // One notification per proposal per run; the condition persists until
    // someone re-saves, so repeating it daily is the point.
    await db.notification.create({
      data: {
        workspaceId,
        userId: p.createdById,
        kind: "INTEGRATION_ERROR",
        severity: "critical",
        title: `Proposal totals do not add up: ${p.company}`,
        body: `"${p.title}" — ${p.differences.join("; ")}. The figures have not been changed. Open the proposal and save it to recompute them.`,
        href: "/proposals",
        leadId: p.leadId,
      },
    });
    notified += 1;
  }

  return { checked: proposals.length, mismatched: bad.length, notified };
}
