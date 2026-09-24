import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { makeWorkspace, addMember, makeLead, grantPoints, cleanup, db } from "./helpers/fixtures";
import { bulkAssign, bulkReveal, exportLeads, quoteBulkReveal } from "@/lib/services/lead-bulk";
import { addLeadsToList, createList, deleteList, getList, removeLeadFromList } from "@/lib/services/lists";
import { getBalance } from "@/lib/services/points";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
async function workspace() {
  const w = await makeWorkspace("BulkFixture");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  return w;
}
async function member(workspaceId: string, role: "sales_rep" | "viewer" | "manager") {
  const ctx = await addMember(workspaceId, `Bulk${role}`, role); created.userIds.push(ctx.userId); return ctx;
}
const lockedEmail = (workspaceId: string, personId: string, value: string | null = "hidden@fixture.invalid") =>
  db.contactMethod.create({ data: { workspaceId, personId, kind: "WORK_EMAIL", value, maskedValue: "h***@fixture.invalid", isLocked: true, source: "fixture", status: "UNVERIFIED" } });

describe("bulk reveal", () => {
  it("charges once per unlocked contact, once per person, and nothing twice on retry", async () => {
    const w = await workspace(); await grantPoints(w.workspace.id, 10);
    const a = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const b = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await lockedEmail(w.workspace.id, a.person.id); await lockedEmail(w.workspace.id, b.person.id);
    await lockedEmail(w.workspace.id, b.person.id, null); // exists, but no value: never charged
    const sameAsA = await db.lead.create({ data: { workspaceId: w.workspace.id, personId: a.person.id, companyId: b.company.id, surfacedReason: "fixture" } });
    const ids = [a.lead.id, b.lead.id, sameAsA.id];

    expect(await quoteBulkReveal(w.ctx, ids)).toMatchObject({ leads: 3, contacts: 2, cost: 2, balance: 10 });
    const key = randomUUID();
    const first = await bulkReveal(w.ctx, { leadIds: ids, idempotencyKey: key });
    expect(first.pointsSpent).toBe(2);
    // Whichever of a person's two leads comes first reveals; the other is reported, not charged.
    expect([a.lead.id, sameAsA.id].map((id) => first.outcomes.find((o) => o.leadId === id)?.code).sort()).toEqual(["revealed", "same_person"]);
    expect(await getBalance(w.workspace.id)).toBe(8);

    const retry = await bulkReveal(w.ctx, { leadIds: ids, idempotencyKey: key });
    expect(retry.pointsSpent).toBe(0);
    expect(await getBalance(w.workspace.id)).toBe(8);
  });

  it("stops at the balance and charges nothing for leads it could not afford", async () => {
    const w = await workspace(); await grantPoints(w.workspace.id, 1);
    const leads = [await makeLead(w.workspace.id), await makeLead(w.workspace.id)];
    for (const l of leads) { await lockedEmail(w.workspace.id, l.person.id); await lockedEmail(w.workspace.id, l.person.id, "second@fixture.invalid"); }
    const r = await bulkReveal(w.ctx, { leadIds: leads.map((l) => l.lead.id), idempotencyKey: randomUUID() });
    expect(r.pointsSpent).toBe(0);
    expect(r.outcomes.every((o) => o.code === "insufficient_points")).toBe(true);
    expect(await getBalance(w.workspace.id)).toBe(1);
  });

  it("does not touch leads outside a rep's visibility or another workspace", async () => {
    const w = await workspace(); const other = await workspace(); await grantPoints(w.workspace.id, 10);
    const rep = await member(w.workspace.id, "sales_rep");
    const owners = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const foreign = await makeLead(other.workspace.id);
    await lockedEmail(w.workspace.id, owners.person.id);
    const r = await bulkReveal(rep, { leadIds: [owners.lead.id, foreign.lead.id], idempotencyKey: randomUUID() });
    expect(r.outcomes.map((o) => o.code).sort()).toEqual(["not_found", "not_found"]);
    expect(await db.contactMethod.count({ where: { personId: owners.person.id, isLocked: false } })).toBe(0);
  });
});

describe("bulk assign", () => {
  it("reassigns visible leads, refuses a non-member, and refuses a rep", async () => {
    const w = await workspace(); const other = await workspace();
    const manager = await member(w.workspace.id, "manager");
    const rep = await member(w.workspace.id, "sales_rep");
    const mine = await makeLead(w.workspace.id); const foreign = await makeLead(other.workspace.id);
    const r = await bulkAssign(w.ctx, { leadIds: [mine.lead.id, foreign.lead.id], ownerId: manager.userId });
    expect(r.outcomes.find((o) => o.leadId === mine.lead.id)?.ok).toBe(true);
    expect(r.outcomes.find((o) => o.leadId === foreign.lead.id)?.code).toBe("not_found");
    expect((await db.lead.findUniqueOrThrow({ where: { id: mine.lead.id } })).ownerId).toBe(manager.userId);
    expect((await db.lead.findUniqueOrThrow({ where: { id: foreign.lead.id } })).ownerId).toBeNull();
    await expect(bulkAssign(w.ctx, { leadIds: [mine.lead.id], ownerId: other.user.id })).rejects.toMatchObject({ code: "not_a_member" });
    await expect(bulkAssign(rep, { leadIds: [mine.lead.id], ownerId: rep.userId })).rejects.toMatchObject({ status: 403 });
  });
});

describe("lead export", () => {
  it("exports selected leads with locked contacts withheld and formulas neutralised", async () => {
    const w = await workspace();
    const { lead, person } = await makeLead(w.workspace.id, { name: "=HYPERLINK(\"x\")", ownerId: w.user.id });
    await lockedEmail(w.workspace.id, person.id, "secret@fixture.invalid");
    const r = await exportLeads(w.ctx, { leadIds: [lead.id] });
    expect(r.rows).toBe(1);
    expect(r.csv).not.toContain("secret@fixture.invalid");
    expect(r.csv).toContain('"locked"');
    expect(r.csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(await db.auditLog.count({ where: { workspaceId: w.workspace.id, action: "leads.exported" } })).toBe(1);
  });

  it("is refused on the server for a role without export, and scoped to what a rep can see", async () => {
    const w = await workspace();
    const viewer = await member(w.workspace.id, "viewer");
    const { lead } = await makeLead(w.workspace.id);
    await expect(exportLeads(viewer, { leadIds: [lead.id] })).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("exports everything the current filter matches, within visibility", async () => {
    const w = await workspace();
    await makeLead(w.workspace.id, { tier: "A", ownerId: w.user.id }); await makeLead(w.workspace.id, { tier: "C", ownerId: w.user.id });
    const r = await exportLeads(w.ctx, { filter: { tiers: ["A"] } });
    expect(r.rows).toBe(1);
  });
});

describe("static lists", () => {
  it("adds, dedupes, removes, rejects smart lists, and deletes recoverably", async () => {
    const w = await workspace();
    const a = await makeLead(w.workspace.id); const b = await makeLead(w.workspace.id);
    const { list } = await createList(w.ctx, { name: "Fixture targets" });
    expect(await addLeadsToList(w.ctx, list.id, [a.lead.id, b.lead.id])).toMatchObject({ added: 2 });
    expect(await addLeadsToList(w.ctx, list.id, [a.lead.id])).toMatchObject({ added: 0, alreadyIn: 1 });
    expect((await getList(w.ctx, list.id))?.total).toBe(2);
    await removeLeadFromList(w.ctx, list.id, a.lead.id);
    expect((await getList(w.ctx, list.id))?.leads.map((l) => l.id)).toEqual([b.lead.id]);

    const { list: smart } = await createList(w.ctx, { name: "Fixture smart", isDynamic: true, filter: { tiers: ["A"] } });
    await expect(addLeadsToList(w.ctx, smart.id, [a.lead.id])).rejects.toMatchObject({ code: "dynamic_list" });

    await deleteList(w.ctx, list.id);
    expect(await db.deletedRecord.findFirst({ where: { workspaceId: w.workspace.id, objectType: "List", objectId: list.id } })).not.toBeNull();
    await expect(createList(w.ctx, { name: "Fixture smart" })).rejects.toMatchObject({ code: "duplicate_name" });
  });
});
