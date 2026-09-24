import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { MutationError } from "./mutate";
import { revealContacts, updateLead } from "./lead-mutations";
import { InsufficientPointsError, POINT_COSTS, getBalance } from "./points";
import { buildWhere } from "./leads";
import { leadFilterSchema } from "@/lib/leads/filter";
import { recordAudit } from "./audit";
import { toCsv } from "@/lib/export/csv";

/**
 * Bulk operations over selected leads. Each one reuses the single-lead service,
 * so a bulk payload gets exactly the checks a single click does — tenant,
 * visibility, permission, audit — and reports an outcome per lead rather than
 * one success message for a batch that partly failed.
 */
export const leadIdsSchema = z.array(z.string().uuid()).min(1, "Select at least one lead.").max(200, "Up to 200 leads at a time.");
export type BulkOutcome = { leadId: string; ok: boolean; code: string; message: string };

/** Only leads this person may see; the rest are reported as not found, never processed. */
async function visibleLeads(ctx: AuthContext, ids: string[]) {
  return db.lead.findMany({
    where: { id: { in: [...new Set(ids)] }, workspaceId: ctx.workspaceId, deletedAt: null, ...leadVisibilityFilter(ctx) },
    select: { id: true, personId: true, person: { select: { fullName: true } } },
  });
}

export async function quoteBulkReveal(ctx: AuthContext, rawIds: unknown) {
  assertPermission(ctx, PERMISSIONS.LEADS_REVEAL);
  const ids = leadIdsSchema.parse(rawIds);
  const leads = await visibleLeads(ctx, ids);
  // One person can sit behind two leads; their contacts are charged once.
  const personIds = [...new Set(leads.map((l) => l.personId))];
  const chargeable = await db.contactMethod.count({ where: { workspaceId: ctx.workspaceId, personId: { in: personIds }, isLocked: true, value: { not: null }, optedOutAt: null } });
  return { leads: leads.length, notFound: new Set(ids).size - leads.length, contacts: chargeable, cost: chargeable * POINT_COSTS.REVEAL_CONTACT, balance: await getBalance(ctx.workspaceId) };
}

export async function bulkReveal(ctx: AuthContext, raw: unknown) {
  const { leadIds, idempotencyKey } = z.object({ leadIds: leadIdsSchema, idempotencyKey: z.string().uuid() }).parse(raw);
  assertPermission(ctx, PERMISSIONS.LEADS_REVEAL);
  const leads = await visibleLeads(ctx, leadIds);
  const outcomes: BulkOutcome[] = [];
  const seenPeople = new Set<string>();
  let spent = 0; let outOfPoints = false;
  for (const lead of leads) {
    if (seenPeople.has(lead.personId)) { outcomes.push({ leadId: lead.id, ok: true, code: "same_person", message: `${lead.person.fullName}'s contacts were revealed on another selected lead.` }); continue; }
    seenPeople.add(lead.personId);
    if (outOfPoints) { outcomes.push({ leadId: lead.id, ok: false, code: "insufficient_points", message: "Not attempted: the balance ran out." }); continue; }
    try {
      // A key per lead makes a retried batch charge nothing twice.
      const r = await revealContacts(ctx, lead.id, { idempotencyKey: `${idempotencyKey}:${lead.id}` });
      spent += r.pointsSpent;
      outcomes.push({ leadId: lead.id, ok: true, code: "revealed", message: `${r.revealed.length} revealed for ${lead.person.fullName}.` });
    } catch (err) {
      if (err instanceof InsufficientPointsError) { outOfPoints = true; outcomes.push({ leadId: lead.id, ok: false, code: "insufficient_points", message: `Needs ${err.required} points, ${err.available} left. Nothing was charged for this lead.` }); continue; }
      const e = err as { code?: string; message?: string };
      outcomes.push({ leadId: lead.id, ok: e.code === "nothing_to_reveal", code: e.code ?? "failed", message: e.message ?? "Reveal failed. Nothing was charged." });
    }
  }
  for (const id of new Set(leadIds)) if (!leads.some((l) => l.id === id)) outcomes.push({ leadId: id, ok: false, code: "not_found", message: "Not found, or not visible to you." });
  return { outcomes, pointsSpent: spent, balance: await getBalance(ctx.workspaceId) };
}

export async function bulkAssign(ctx: AuthContext, raw: unknown) {
  const { leadIds, ownerId } = z.object({ leadIds: leadIdsSchema, ownerId: z.string().uuid().nullable() }).parse(raw);
  if (!ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL)) throw new MutationError("Reassigning leads needs permission to see the whole team's leads.", "forbidden", 403);
  if (ownerId) {
    const member = await db.workspaceMember.findFirst({ where: { workspaceId: ctx.workspaceId, userId: ownerId, deletedAt: null }, select: { id: true } });
    if (!member) throw new MutationError("That person is not a member of this workspace.", "not_a_member", 422);
  }
  const outcomes: BulkOutcome[] = [];
  for (const leadId of new Set(leadIds)) {
    try {
      await updateLead(ctx, leadId, { ownerId });
      outcomes.push({ leadId, ok: true, code: "assigned", message: ownerId ? "Assigned." : "Unassigned." });
    } catch (err) {
      const e = err as { code?: string; message?: string; status?: number };
      outcomes.push({ leadId, ok: false, code: e.status === 404 ? "not_found" : e.code ?? "failed", message: e.status === 404 ? "Not found, or not visible to you." : e.message ?? "Couldn't reassign." });
    }
  }
  return { outcomes };
}

const exportSchema = z.union([
  z.object({ leadIds: leadIdsSchema }),
  z.object({ filter: z.record(z.string(), z.unknown()) }),
]);
const EXPORT_CAP = 5000;

/**
 * CSV of selected leads, or of everything the current filter matches. Locked
 * contacts are never exported — the file says "locked" in their place — and the
 * export is audited, because a file of contact data leaves the product.
 */
export async function exportLeads(ctx: AuthContext, raw: unknown) {
  assertPermission(ctx, PERMISSIONS.LEADS_EXPORT);
  const input = exportSchema.parse(raw);
  const where = "leadIds" in input
    ? { ...buildWhere(ctx, {}), id: { in: input.leadIds } }
    : buildWhere(ctx, leadFilterSchema.parse({ ...input.filter, page: 1 }));
  const total = await db.lead.count({ where });
  if (total > EXPORT_CAP) throw new MutationError(`That is ${total} leads; exports are capped at ${EXPORT_CAP}. Narrow the filter first.`, "export_too_large", 422);
  const leads = await db.lead.findMany({
    where,
    orderBy: { surfacedAt: "desc" },
    include: {
      person: { include: { employments: { where: { isCurrent: true }, take: 1 }, contactMethods: { orderBy: [{ isPrimary: "desc" }, { confidence: "desc" }] } } },
      company: true,
      owner: { select: { name: true } },
      score: { select: { displayScore: true, overriddenScore: true } },
      signals: { where: { deletedAt: null }, orderBy: { occurredAt: "asc" }, take: 1, select: { sourceKind: true, sourceName: true } },
    },
  });
  const contact = (methods: (typeof leads)[number]["person"]["contactMethods"], kinds: string[]) => {
    const m = methods.find((c) => kinds.includes(c.kind) && !c.optedOutAt);
    if (!m) return { value: "", status: "" };
    return m.isLocked ? { value: "locked", status: "" } : { value: m.value ?? "", status: m.verificationResult ?? m.status };
  };
  const header = ["Name", "Title", "Company", "Domain", "Industry", "City", "Status", "Tier", "Intent", "Score (0–10)", "Owner", "Email", "Email verification", "Phone", "LinkedIn", "Source", "Surfaced", "Last contacted", "Next action"];
  const rows = leads.map((l) => {
    const email = contact(l.person.contactMethods, ["WORK_EMAIL", "PERSONAL_EMAIL"]);
    const phone = contact(l.person.contactMethods, ["MOBILE", "DIRECT_PHONE", "SWITCHBOARD"]);
    return [
      l.person.fullName, l.person.employments[0]?.title ?? "", l.company.name, l.company.domain ?? "", l.company.industry ?? "", l.company.city ?? "",
      l.status, l.tier, l.intent, l.score ? String(Number(l.score.overriddenScore ?? l.score.displayScore)) : "", l.owner?.name ?? "",
      email.value, email.status, phone.value, l.person.linkedinUrl ?? "",
      l.signals[0] ? `${l.signals[0].sourceKind} (${l.signals[0].sourceName})` : "", l.surfacedAt.toISOString().slice(0, 10), l.lastContactedAt?.toISOString().slice(0, 10) ?? "", l.nextActionLabel ?? "",
    ];
  });
  await recordAudit(ctx, { action: "leads.exported", objectType: "Lead", after: { rows: rows.length, scope: "leadIds" in input ? "selected" : "filter" } });
  return { filename: `leads-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv([header, ...rows]), rows: rows.length };
}
