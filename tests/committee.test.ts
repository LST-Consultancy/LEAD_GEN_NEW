import { afterAll, describe, expect, it } from "vitest";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { coverage, suggestRole } from "@/lib/accounts/committee";
import { getCommittee, removeCommitteeMember, setCommitteeMember } from "@/lib/services/committee";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
async function workspace() { const w = await makeWorkspace("Committee"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id); return w; }

describe("committee roles", () => {
  it("suggests a role from the title and says which words it rests on", () => {
    expect(suggestRole("Head of Procurement")).toMatchObject({ role: "PROCUREMENT", basis: expect.stringContaining("Procurement") });
    expect(suggestRole("VP Finance").role).toBe("FINANCE");
    expect(suggestRole("Solutions Architect").role).toBe("TECHNICAL_EVALUATOR");
    expect(suggestRole("Managing Director").role).toBe("DECISION_MAKER");
    expect(suggestRole(null).role).toBe("UNKNOWN");
  });
  it("counts only confirmed members toward coverage", () => {
    expect(coverage([{ role: "DECISION_MAKER", confirmed: true }, { role: "FINANCE", confirmed: false }])).toMatchObject({ covered: ["DECISION_MAKER"], singleThreaded: true, unconfirmed: 1 });
  });
});

describe("mapping a committee", () => {
  it("confirms, changes and removes members without deleting history, inside the workspace only", async () => {
    const w = await workspace(); const other = await workspace();
    const company = await db.company.create({ data: { workspaceId: w.workspace.id, name: "Contoso Synthetic", country: "Unknown" } });
    const person = await db.person.create({ data: { workspaceId: w.workspace.id, fullName: "Meera Synthetic", country: "Unknown" } });
    await db.employment.create({ data: { workspaceId: w.workspace.id, personId: person.id, companyId: company.id, title: "Head of Procurement", isCurrent: true } });
    // A lead makes the account visible on the accounts screen.
    await db.lead.create({ data: { workspaceId: w.workspace.id, companyId: company.id, personId: person.id, ownerId: w.user.id, surfacedReason: "fixture" } });
    const before = await getCommittee(w.ctx, company.id);
    expect(before.suggestions).toMatchObject([{ personId: person.id, role: "PROCUREMENT" }]);
    await expect(getCommittee(other.ctx, company.id)).rejects.toThrow(/not found/);
    await expect(setCommitteeMember(other.ctx, company.id, { personId: person.id, role: "CHAMPION" })).rejects.toThrow();
    await setCommitteeMember(w.ctx, company.id, { personId: person.id, role: "PROCUREMENT" });
    const after = await getCommittee(w.ctx, company.id);
    expect(after.members).toMatchObject([{ role: "PROCUREMENT", confirmed: true }]);
    expect(after.coverage.covered).toEqual(["PROCUREMENT"]);
    await removeCommitteeMember(w.ctx, company.id, person.id);
    expect((await getCommittee(w.ctx, company.id)).members).toHaveLength(0);
    expect(await db.committeeMember.findFirstOrThrow({ where: { companyId: company.id } })).toMatchObject({ removedAt: expect.any(Date) });
    expect(await db.auditLog.count({ where: { workspaceId: w.workspace.id, action: { startsWith: "committee." } } })).toBe(2);
  });
});
