import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { getCohortFunnel, getLeadMix } from "@/lib/services/analytics";
import { getDemandByType } from "@/lib/services/opportunities";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
const DAY = 86_400_000;

async function workspace() {
  const w = await makeWorkspace("Reporting");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  return w;
}

describe("cohort funnel", () => {
  it("follows only leads surfaced in the window, and withholds shares for an empty cohort", async () => {
    const w = await workspace();
    expect((await getCohortFunnel(w.ctx)).stages[0].shareOfCohort).toBeNull();
    const a = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const b = await makeLead(w.workspace.id, { ownerId: w.user.id });
    const old = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await db.lead.update({ where: { id: a.lead.id }, data: { lastContactedAt: new Date(), repliedAt: new Date() } });
    await db.lead.update({ where: { id: old.lead.id }, data: { surfacedAt: new Date(Date.now() - 200 * DAY), lastContactedAt: new Date() } });
    void b;
    const f = await getCohortFunnel(w.ctx, { days: 90 });
    expect(Object.fromEntries(f.stages.map((s) => [s.key, s.count]))).toEqual({ surfaced: 2, contacted: 1, replied: 1, deal: 0, won: 0 });
    expect(f.stages[1].shareOfCohort).toBe(0.5);
  });
});

describe("lead mix", () => {
  it("counts by tier and status within visibility", async () => {
    const w = await workspace();
    const rep = await addMember(w.workspace.id, "MixRep", "sales_rep"); created.userIds.push(rep.userId);
    await makeLead(w.workspace.id, { ownerId: w.user.id, tier: "A" });
    await makeLead(w.workspace.id, { ownerId: rep.userId, tier: "A" });
    const all = await getLeadMix(w.ctx);
    expect(all.filter((r) => r.tier === "A").reduce((n, r) => n + r.count, 0)).toBe(2);
    expect((await getLeadMix(rep)).reduce((n, r) => n + r.count, 0)).toBe(1);
  });
});

describe("demand by type", () => {
  it("counts active opportunities per type and distinct companies, other statuses excluded", async () => {
    const w = await workspace();
    const a = await makeLead(w.workspace.id); const b = await makeLead(w.workspace.id);
    const mk = (companyId: string, types: ("MIGRATION" | "IMPLEMENTATION")[], status: "ACTIVE" | "CLOSED", key: string) =>
      db.opportunity.create({ data: { workspaceId: w.workspace.id, companyId, types, status, dedupeKey: key, title: key, service: "ERP" } as never });
    await mk(a.company.id, ["MIGRATION", "IMPLEMENTATION"], "ACTIVE", "o1");
    await mk(b.company.id, ["MIGRATION"], "ACTIVE", "o2");
    await mk(b.company.id, ["MIGRATION"], "CLOSED", "o3");
    const d = await getDemandByType(w.ctx);
    expect(d.total).toBe(2);
    expect(d.types.find((t) => t.type === "MIGRATION")).toEqual({ type: "MIGRATION", opportunities: 2, companies: 2 });
    expect(d.types.find((t) => t.type === "IMPLEMENTATION")).toEqual({ type: "IMPLEMENTATION", opportunities: 1, companies: 1 });
  });
});
