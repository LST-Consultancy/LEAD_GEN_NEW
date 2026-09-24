import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import {
  getSignalFreshness,
  getLiveDemand,
  getRadar,
  getCompetitors,
  getMarketIntelligence,
} from "@/lib/services/signals";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function freshWorkspace() {
  const w = await makeWorkspace("Signals");
  created.workspaceIds.push(w.workspace.id);
  created.userIds.push(w.user.id);
  created.planIds.push(w.plan.id);
  return w;
}

let seq = 0;
async function makeSignal(
  workspaceId: string,
  over: {
    type?: string;
    title?: string;
    excerpt?: string;
    keywords?: string[];
    companyId?: string;
    leadId?: string;
    intentDelta?: number;
    daysAgo?: number;
  } = {}
) {
  seq += 1;
  return db.signal.create({
    data: {
      workspaceId,
      type: (over.type ?? "HIRING") as never,
      sourceKind: "PUBLIC_WEB",
      sourceName: "Company careers page",
      title: over.title ?? `Signal ${seq}`,
      excerpt: over.excerpt ?? "Some text.",
      keywords: over.keywords ?? [],
      companyId: over.companyId,
      leadId: over.leadId,
      intentDelta: over.intentDelta ?? 10,
      occurredAt: new Date(Date.now() - (over.daysAgo ?? 1) * 86_400_000),
      detectedAt: new Date(Date.now() - (over.daysAgo ?? 1) * 86_400_000),
      dedupeHash: `h-${workspaceId}-${seq}`,
    },
  });
}

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("freshness", () => {
  it("says plainly that the set is not growing when nothing is connected", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeSignal(workspace.id);

    const f = await getSignalFreshness(ctx);
    expect(f.connected).toBe(false);
    expect(f.notice).toMatch(/phrase watching has no connected source/);
    expect(f.notice).toMatch(/only when an opportunity is converted/);
  });

  it("says so differently when there are no signals at all", async () => {
    const { ctx } = await freshWorkspace();
    const f = await getSignalFreshness(ctx);
    expect(f.total).toBe(0);
    expect(f.notice).toMatch(/No signals recorded yet/);
    expect(f.notice).toMatch(/under Opportunities/);
  });

  it("measures the age of the newest signal", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeSignal(workspace.id, { daysAgo: 0 });
    const f = await getSignalFreshness(ctx);
    expect(f.newestAgeHours).toBeLessThan(2);
    expect(f.last7).toBe(1);
  });
});

describe("live demand", () => {
  it("groups by what the signal means, not where it came from", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await makeSignal(workspace.id, { type: "RFP", companyId: company.id });
    await makeSignal(workspace.id, { type: "FUNDING", companyId: company.id });
    await makeSignal(workspace.id, { type: "HIRING", companyId: company.id });

    const demand = await getLiveDemand(ctx);
    const keys = demand.categories.map((c) => c.key);
    expect(keys).toContain("in_market");
    expect(keys).toContain("capacity");
    expect(keys).toContain("hiring");
  });

  it("counts companies as well as signals, so one noisy company is not an opportunity each time", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await makeSignal(workspace.id, { type: "SOCIAL_POST", companyId: company.id });
    await makeSignal(workspace.id, { type: "SOCIAL_POST", companyId: company.id });
    await makeSignal(workspace.id, { type: "SOCIAL_POST", companyId: company.id });

    const demand = await getLiveDemand(ctx);
    const said = demand.categories.find((c) => c.key === "said_something")!;
    expect(said.count).toBe(3);
    expect(said.companies).toBe(1);
  });

  it("names uncategorised signals rather than dropping them", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeSignal(workspace.id, { type: "MANUAL_NOTE" });

    const demand = await getLiveDemand(ctx);
    expect(demand.uncategorised).toBe(1);
    expect(demand.uncategorisedTypes).toContain("MANUAL_NOTE");
    // And the total still counts it.
    expect(demand.total).toBe(1);
  });

  it("omits an empty category rather than showing a zero", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeSignal(workspace.id, { type: "HIRING" });
    const demand = await getLiveDemand(ctx);
    expect(demand.categories.every((c) => c.count > 0)).toBe(true);
  });

  it("keeps a company signal visible but hides another rep's lead link", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await makeSignal(workspace.id, { type: "RFP", companyId: company.id, leadId: lead.id });
    const rep = await addMember(workspace.id, "Rep", "sales_rep");

    const asOwner = await getLiveDemand(ctx);
    const asRep = await getLiveDemand(rep);
    expect(asOwner.categories[0].signals[0].lead).not.toBeNull();
    // The signal is still workspace knowledge; the lead link is not theirs.
    expect(asRep.total).toBe(1);
    expect(asRep.categories[0].signals[0].lead).toBeNull();
  });

  it("respects the time window", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await makeSignal(workspace.id, { daysAgo: 2 });
    await makeSignal(workspace.id, { daysAgo: 60 });

    expect((await getLiveDemand(ctx, { days: 30 })).total).toBe(1);
    expect((await getLiveDemand(ctx, { days: 90 })).total).toBe(2);
  });

  it("does not cross workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await makeSignal(b.workspace.id);
    expect((await getLiveDemand(a.ctx)).total).toBe(0);
    expect((await getLiveDemand(b.ctx)).total).toBe(1);
  });
});

describe("radar", () => {
  it("reports whether a watch has ever seen anything", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await makeSignal(workspace.id, { companyId: company.id });
    await makeSignal(workspace.id, { companyId: company.id });

    await db.radarWatch.create({
      data: {
        workspaceId: workspace.id,
        targetKind: "COMPANY",
        targetId: company.id,
        targetLabel: company.name,
        alertOn: ["HIRING"],
      },
    });
    await db.radarWatch.create({
      data: {
        workspaceId: workspace.id,
        targetKind: "KEYWORD",
        targetLabel: "erp migration",
        alertOn: ["SOCIAL_POST"],
      },
    });

    const watches = await getRadar(ctx);
    const onCompany = watches.find((w) => w.targetKind === "COMPANY")!;
    const onKeyword = watches.find((w) => w.targetKind === "KEYWORD")!;
    expect(onCompany.signalsSeen).toBe(2);
    // A keyword watch has no company to count against; honest zero.
    expect(onKeyword.signalsSeen).toBe(0);
  });

  it("does not cross workspaces", async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await db.radarWatch.create({
      data: {
        workspaceId: b.workspace.id,
        targetKind: "KEYWORD",
        targetLabel: "theirs",
        alertOn: [],
      },
    });
    expect(await getRadar(a.ctx)).toHaveLength(0);
    expect(await getRadar(b.ctx)).toHaveLength(1);
  });
});

describe("competitors", () => {
  it("matches a mention by name or alias, in the title or the body", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.competitor.create({
      data: {
        workspaceId: workspace.id,
        name: "Bigcorp Systems",
        aliases: ["Bigcorp", "BCS"],
      },
    });

    await makeSignal(workspace.id, {
      type: "COMPETITOR_MENTION",
      title: "Evaluating Bigcorp Systems",
      companyId: company.id,
    });
    await makeSignal(workspace.id, {
      type: "SOCIAL_POST",
      title: "Vendor shortlist",
      excerpt: "We are also looking at BCS.",
      keywords: ["shortlist"],
      companyId: company.id,
    });

    const result = await getCompetitors(ctx);
    expect(result.competitors[0].mentionCount).toBe(2);
    expect(result.competitors[0].companiesMentioning).toBe(1);
  });

  it("counts mentions that match no tracked competitor", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await db.competitor.create({
      data: { workspaceId: workspace.id, name: "Bigcorp", aliases: [] },
    });
    await makeSignal(workspace.id, {
      type: "COMPETITOR_MENTION",
      title: "Looking at SomeoneElse Ltd",
    });

    const result = await getCompetitors(ctx);
    expect(result.competitors[0].mentionCount).toBe(0);
    // Surfaced: this is how you find a competitor you are not tracking.
    expect(result.untracked).toBe(1);
  });

  it("is case-insensitive", async () => {
    const { ctx, workspace } = await freshWorkspace();
    await db.competitor.create({
      data: { workspaceId: workspace.id, name: "BigCorp", aliases: [] },
    });
    await makeSignal(workspace.id, {
      type: "COMPETITOR_MENTION",
      title: "comparing bigcorp and others",
    });
    expect((await getCompetitors(ctx)).competitors[0].mentionCount).toBe(1);
  });
});

describe("market intelligence", () => {
  it("buckets by industry and state with averages, not just totals", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const a = await makeLead(workspace.id, { ownerId: ctx.userId, industry: "Manufacturing" });
    const b = await makeLead(workspace.id, { ownerId: ctx.userId, industry: "Manufacturing" });
    await db.company.update({ where: { id: a.company.id }, data: { intentScore: 80 } });
    await db.company.update({ where: { id: b.company.id }, data: { intentScore: 20 } });
    await makeSignal(workspace.id, { companyId: a.company.id });

    const market = await getMarketIntelligence(ctx);
    const manufacturing = market.industries.find((i) => i.value === "Manufacturing")!;
    expect(manufacturing.companies).toBe(2);
    expect(manufacturing.signals).toBe(1);
    expect(manufacturing.avgIntent).toBe(50);
    expect(manufacturing.signalsPerCompany).toBe(0.5);
  });

  it("states that it describes your pipeline, not the market", async () => {
    const { ctx } = await freshWorkspace();
    const market = await getMarketIntelligence(ctx);
    expect(market.caveat).toMatch(/not the market as a whole/);
  });

  it("attributes deal value to the company's sector", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { lead, company } = await makeLead(workspace.id, {
      ownerId: ctx.userId,
      industry: "Logistics",
    });
    const pipeline = await db.pipeline.create({
      data: { workspaceId: workspace.id, name: "P", isDefault: true },
    });
    const stage = await db.pipelineStage.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        key: "q",
        name: "Q",
        sortOrder: 0,
        probability: 30,
      },
    });
    await db.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        leadId: lead.id,
        companyId: company.id,
        title: "D",
        valueInr: 900_000,
        status: "OPEN",
      },
    });

    const market = await getMarketIntelligence(ctx);
    expect(market.industries.find((i) => i.value === "Logistics")!.openInr).toBe(900_000);
  });

  it("omits companies with no industry rather than bucketing them as blank", async () => {
    const { ctx, workspace } = await freshWorkspace();
    const { company } = await makeLead(workspace.id, { ownerId: ctx.userId });
    await db.company.update({ where: { id: company.id }, data: { industry: null } });
    const market = await getMarketIntelligence(ctx);
    expect(market.industries.every((i) => i.value.length > 0)).toBe(true);
  });
});
