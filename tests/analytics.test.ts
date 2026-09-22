import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { getFunnel, getSourceAttribution, getTeamPerformance } from "@/lib/services/analytics";
import {
  listLists,
  createList,
  deleteList,
  listSavedSearches,
  createSavedSearch,
  setSavedSearchAlert,
  deleteSavedSearch,
} from "@/lib/services/lists";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Analytics");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

async function makeDeal(
  workspaceId: string,
  leadId: string,
  companyId: string,
  over: { value?: number; status?: string; ownerId?: string; wonAt?: Date } = {}
) {
  const pipeline = await db.pipeline.findFirst({ where: { workspaceId } }) ??
    (await db.pipeline.create({ data: { workspaceId, name: "P", isDefault: true } }));
  const stage = await db.pipelineStage.findFirst({ where: { pipelineId: pipeline.id } }) ??
    (await db.pipelineStage.create({
      data: { workspaceId, pipelineId: pipeline.id, key: "q", name: "Q", sortOrder: 0, probability: 30 },
    }));
  return db.deal.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      leadId,
      companyId,
      ownerId: over.ownerId,
      title: "Deal",
      valueInr: over.value ?? 1_000_000,
      status: (over.status ?? "OPEN") as never,
      wonAt: over.wonAt,
    },
  });
}

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("the funnel", () => {
  it("counts each stage independently and says why", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({
      where: { id: lead.id },
      data: { lastContactedAt: new Date(), repliedAt: new Date() },
    });
    await makeDeal(workspace.id, lead.id, company.id, {
      status: "WON",
      wonAt: new Date(),
      value: 2_000_000,
    });

    const funnel = await getFunnel(ctx);
    const byKey = new Map(funnel.stages.map((s) => [s.key, s]));
    expect(byKey.get("leads")!.count).toBe(1);
    expect(byKey.get("contacted")!.count).toBe(1);
    expect(byKey.get("replied")!.count).toBe(1);
    expect(byKey.get("won")!.count).toBe(1);
    expect(funnel.wonInr).toBe(2_000_000);
    expect(funnel.caveat).toMatch(/not one cohort/);
  });

  it("keeps both terms of every ratio", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const a = await makeLead(workspace.id, { ownerId: ctx.userId });
    await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: a.lead.id }, data: { lastContactedAt: new Date() } });

    const funnel = await getFunnel(ctx);
    const contacted = funnel.stages.find((s) => s.key === "contacted")!;
    expect(contacted.fromPrevious).toBe(50);
    expect(contacted.previousLabel).toBe("Leads surfaced");
    expect(contacted.previousCount).toBe(2);
  });

  it("reports null rather than a rate against zero", async () => {
    const { ctx } = await freshWorkspace();
    const funnel = await getFunnel(ctx);
    expect(funnel.stages.every((s) => s.fromPrevious === null)).toBe(true);
  });

  it("does not cross workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await makeLead(b.workspace.id, { ownerId: b.ctx.userId });
    expect((await getFunnel(a.ctx)).stages.find((s) => s.key === "leads")!.count).toBe(0);
  });
});

describe("source attribution", () => {
  it("reports unattributed leads as their own row rather than dropping them", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeLead(workspace.id, { ownerId: ctx.userId });

    const attribution = await getSourceAttribution(ctx);
    expect(attribution.unattributedLeads).toBe(1);
    expect(attribution.rows.find((r) => r.key === "__unattributed")?.label).toBe(
      "No recorded source"
    );
    expect(attribution.attributionCoverage).toBe(0);
  });

  it("attributes revenue to the phrase's source kind", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const phrase = await db.searchPhrase.create({
      data: {
        workspaceId: workspace.id,
        phrase: "erp migration",
        sourceKind: "PUBLIC_WEB",
        isActive: true,
        cadenceHours: 24,
      },
    });
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { sourcePhraseId: phrase.id } });
    await makeDeal(workspace.id, lead.id, company.id, {
      status: "WON",
      wonAt: new Date(),
      value: 3_000_000,
    });

    const attribution = await getSourceAttribution(ctx);
    const row = attribution.rows.find((r) => r.key === "PUBLIC_WEB")!;
    expect(row.wonInr).toBe(3_000_000);
    expect(row.wonCount).toBe(1);
    expect(attribution.attributionCoverage).toBe(100);
  });

  it("gives a null reply rate rather than zero when nothing replied", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeLead(workspace.id, { ownerId: ctx.userId });
    const attribution = await getSourceAttribution(ctx);
    expect(attribution.rows[0].replyRate).toBe(0);
    expect(attribution.rows[0].leads).toBe(1);
  });

  it("sorts by revenue, so the source that pays is first", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const rich = await db.searchPhrase.create({
      data: { workspaceId: workspace.id, phrase: "a", sourceKind: "TENDER_PORTAL", cadenceHours: 24 },
    });
    const poor = await db.searchPhrase.create({
      data: { workspaceId: workspace.id, phrase: "b", sourceKind: "JOB_BOARD", cadenceHours: 24 },
    });
    const one = await makeLead(workspace.id, { ownerId: ctx.userId });
    const two = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: one.lead.id }, data: { sourcePhraseId: rich.id } });
    await db.lead.update({ where: { id: two.lead.id }, data: { sourcePhraseId: poor.id } });
    await makeDeal(workspace.id, one.lead.id, one.company.id, {
      status: "WON",
      wonAt: new Date(),
      value: 5_000_000,
    });

    const attribution = await getSourceAttribution(ctx);
    expect(attribution.rows[0].key).toBe("TENDER_PORTAL");
  });
});

describe("team performance", () => {
  it("shows activity and conversion side by side", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({
      where: { id: lead.id },
      data: { lastContactedAt: new Date(), repliedAt: new Date() },
    });
    await makeDeal(workspace.id, lead.id, company.id, {
      status: "WON",
      wonAt: new Date(),
      value: 1_500_000,
      ownerId: ctx.userId,
    });

    const team = await getTeamPerformance(ctx);
    const me = team.rows.find((r) => r.userId === ctx.userId)!;
    expect(me.leads).toBe(1);
    expect(me.contacted).toBe(1);
    expect(me.replied).toBe(1);
    expect(me.replyRate).toBe(100);
    expect(me.wonInr).toBe(1_500_000);
  });

  it("flags busy-but-not-converting only above a stated volume", async () => {
    const { ctx, workspace } = await freshWorkspace();
    // Nine contacted, none replied — below the threshold, so no flag.
    for (let i = 0; i < 9; i++) {
      const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
      await db.lead.update({ where: { id: lead.id }, data: { lastContactedAt: new Date() } });
    }
    let team = await getTeamPerformance(ctx);
    expect(team.rows.find((r) => r.userId === ctx.userId)!.busyNotConverting).toBe(false);

    // The tenth crosses it.
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.lead.update({ where: { id: lead.id }, data: { lastContactedAt: new Date() } });
    team = await getTeamPerformance(ctx);
    expect(team.rows.find((r) => r.userId === ctx.userId)!.busyNotConverting).toBe(true);
    expect(team.busyNotConvertingThreshold).toEqual({ minContacted: 10, maxReplyRate: 10 });
  });

  it("gives a null reply rate when nobody was contacted", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeLead(workspace.id, { ownerId: ctx.userId });
    const team = await getTeamPerformance(ctx);
    expect(team.rows.find((r) => r.userId === ctx.userId)!.replyRate).toBeNull();
  });

  it("includes every member, even one with nothing yet", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await addMember(workspace.id, "Newcomer", "sales_rep");
    const team = await getTeamPerformance(ctx);
    expect(team.teamSize).toBe(2);
    expect(team.rows).toHaveLength(2);
    expect(team.activeCount).toBe(0);
  });

  it("counts overdue tasks separately from open ones", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await db.task.createMany({
      data: [
        {
          workspaceId: workspace.id,
          title: "Overdue",
          ownerId: ctx.userId,
          dueAt: new Date(Date.now() - 86_400_000),
        },
        {
          workspaceId: workspace.id,
          title: "Later",
          ownerId: ctx.userId,
          dueAt: new Date(Date.now() + 86_400_000),
        },
      ],
    });
    const team = await getTeamPerformance(ctx);
    const me = team.rows.find((r) => r.userId === ctx.userId)!;
    expect(me.tasksOpen).toBe(2);
    expect(me.tasksOverdue).toBe(1);
  });
});

describe("lists", () => {
  it("counts a smart list by running its filter", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A" });
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "D" });

    await createList(ctx, {
      name: "Tier A only",
      isDynamic: true,
      filter: { tiers: ["A"] },
    });

    const [list] = await listLists(ctx);
    expect(list.isDynamic).toBe(true);
    expect(list.count).toBe(1);
    // A smart list has no fixed membership.
    expect(list.totalMembers).toBeNull();
  });

  it("counts a static list by its members, respecting visibility", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId });
    const { list } = await createList(ctx, { name: "Static", isDynamic: false });
    await db.listMember.create({
      data: { workspaceId: workspace.id, listId: list.id, leadId: lead.id },
    });

    const rep = await addMember(workspace.id, "Rep", "sales_rep");
    expect((await listLists(ctx))[0].count).toBe(1);
    // The rep cannot see that lead, so the count must not claim they can.
    expect((await listLists(rep))[0].count).toBe(0);
    expect((await listLists(rep))[0].totalMembers).toBe(1);
  });

  it("marks a smart list whose filter no longer parses", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { list } = await createList(ctx, {
      name: "Will break",
      isDynamic: true,
      filter: { tiers: ["A"] },
    });
    await db.list.update({
      where: { id: list.id },
      data: { filterJson: { tiers: "not-an-array" } },
    });

    const [listed] = await listLists(ctx);
    expect(listed.broken).toBe(true);
    expect(listed.count).toBe(0);
    void workspace;
  });

  it("refuses a smart list with no conditions", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createList(ctx, { name: "Everything", isDynamic: true, filter: {} })
    ).rejects.toThrow(/just every lead/);
  });

  it("refuses a filter it cannot run", async () => {
    const { ctx } = await freshWorkspace();
    await expect(
      createList(ctx, { name: "Bad", isDynamic: true, filter: { tiers: "A" } })
    ).rejects.toThrow(/not one this app can run/);
  });

  it("says deleting a list leaves the leads alone", async () => {
    const { ctx } = await freshWorkspace();
    const { list } = await createList(ctx, { name: "Temp", isDynamic: false });
    const result = await deleteList(ctx, list.id);
    expect(result.note).toMatch(/leads it held are untouched/);
  });

  it("refuses a duplicate name", async () => {
    const { ctx } = await freshWorkspace();
    await createList(ctx, { name: "Same", isDynamic: false });
    await expect(createList(ctx, { name: "Same", isDynamic: false })).rejects.toThrow(
      /already exists/
    );
  });
});

describe("saved searches", () => {
  it("reports how many it matches now", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A" });
    await makeLead(workspace.id, { ownerId: ctx.userId, tier: "D" });
    await createSavedSearch(ctx, { name: "A only", filter: { tiers: ["A"] } });

    const [saved] = await listSavedSearches(ctx);
    expect(saved.matches).toBe(1);
    expect(saved.countable).toBe(true);
    expect(saved.broken).toBe(false);
  });

  it("marks a search whose filter no longer parses", async () => {
    const { ctx } = await freshWorkspace();
    const { savedSearch } = await createSavedSearch(ctx, {
      name: "Will break",
      filter: { tiers: ["A"] },
    });
    await db.savedSearch.update({
      where: { id: savedSearch.id },
      data: { filterJson: { tiers: 5 } },
    });

    const [saved] = await listSavedSearches(ctx);
    expect(saved.broken).toBe(true);
    expect(saved.matches).toBeNull();
  });

  it("says alerts only fire on new matches, which need a source", async () => {
    const { ctx } = await freshWorkspace();
    const result = await createSavedSearch(ctx, {
      name: "Alerting",
      filter: { tiers: ["A"] },
      alertEnabled: true,
    });
    expect(result.note).toMatch(/no discovery source is connected/);
  });

  it("toggles alerts without losing the search", async () => {
    const { ctx } = await freshWorkspace();
    const { savedSearch } = await createSavedSearch(ctx, {
      name: "Toggle",
      filter: { tiers: ["A"] },
    });
    const off = await setSavedSearchAlert(ctx, savedSearch.id, false);
    expect(off.note).toMatch(/search is kept/);
    expect((await listSavedSearches(ctx)).length).toBe(1);
  });

  it("says deleting one affects no leads", async () => {
    const { ctx } = await freshWorkspace();
    const { savedSearch } = await createSavedSearch(ctx, {
      name: "Temp",
      filter: { tiers: ["A"] },
    });
    const result = await deleteSavedSearch(ctx, savedSearch.id);
    expect(result.note).toMatch(/only a stored query/);
  });

  it("does not cross workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await createSavedSearch(b.ctx, { name: "Theirs", filter: { tiers: ["A"] } });
    expect(await listSavedSearches(a.ctx)).toHaveLength(0);
    expect(await listSavedSearches(b.ctx)).toHaveLength(1);
  });
});
