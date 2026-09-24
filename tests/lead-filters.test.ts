import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, cleanup } from "./helpers/fixtures";
import type { AuthContext } from "@/lib/auth/context";
import { getFilterFacets, listLeads } from "@/lib/services/leads";
import { filterProblems, leadFilterSchema } from "@/lib/leads/filter";
import { buildLeadQuery, parseLeadParams } from "@/lib/leads/params";
import { startOfLocalDay } from "@/lib/format";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

let ctx: AuthContext;
const ids: Record<string, string> = {};
const run = async (f: object) => (await listLeads(ctx, leadFilterSchema.parse({ pageSize: 200, ...f }))).rows.map((r: { id: string }) => r.id);

beforeAll(async () => {
  const w = await makeWorkspace("Filters");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  ctx = w.ctx;
  const mk = async (key: string, company: object, surfacedAt: Date, source?: "JOB_BOARD" | "NEWS", seniority?: string) => {
    const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await db.company.update({ where: { id: lead.companyId }, data: company });
    await db.lead.update({ where: { id: lead.id }, data: { surfacedAt } });
    if (source) await db.signal.create({ data: { workspaceId: w.workspace.id, leadId: lead.id, companyId: lead.companyId, type: "HIRING", sourceKind: source, sourceName: "fixture", title: "fixture", excerpt: "fixture", keywords: [], dedupeHash: `fixture-${key}`, occurredAt: surfacedAt } });
    if (seniority) await db.employment.updateMany({ where: { personId: lead.personId }, data: { seniority } });
    ids[key] = lead.id;
  };
  // 20:00 UTC on the 3rd is 01:30 on the 4th in India.
  await mk("indiaTaggedJobs", { country: "India", tags: ["imported", "priority"] }, new Date("2026-09-03T20:00:00Z"), "JOB_BOARD", "c_level");
  await mk("ukNews", { country: "United Kingdom", tags: [] }, new Date("2026-09-10T06:00:00Z"), "NEWS", "manager");
});

describe("new lead filters", () => {
  it("country", async () => {
    expect(await run({ countries: ["India"] })).toEqual([ids.indiaTaggedJobs]);
    expect(await run({ countries: ["United Kingdom"] })).toEqual([ids.ukNews]);
  });
  it("company tag", async () => {
    expect(await run({ tags: ["priority"] })).toEqual([ids.indiaTaggedJobs]);
    expect(await run({ tags: ["unused-tag"] })).toEqual([]);
  });
  it("source", async () => {
    expect(await run({ sources: ["JOB_BOARD"] })).toEqual([ids.indiaTaggedJobs]);
    expect((await run({ sources: ["JOB_BOARD", "NEWS"] })).sort()).toEqual([ids.indiaTaggedJobs, ids.ukNews].sort());
  });
  it("added date range uses the workspace's calendar day, and the end day is included", async () => {
    // In UTC this lead was added on the 3rd; in the workspace's timezone, the 4th.
    expect(await run({ surfacedFrom: "2026-09-04", surfacedTo: "2026-09-04" })).toEqual([ids.indiaTaggedJobs]);
    expect(await run({ surfacedTo: "2026-09-03" })).toEqual([]);
    expect(await run({ surfacedFrom: "2026-09-05" })).toEqual([ids.ukNews]);
    expect(startOfLocalDay("2026-09-04", "Asia/Kolkata").toISOString()).toBe("2026-09-03T18:30:00.000Z");
  });
  it("within a group values are OR-ed; groups AND by default and OR when asked", async () => {
    expect(await run({ countries: ["India"], sources: ["NEWS"] })).toEqual([]);
    expect((await run({ countries: ["India"], sources: ["NEWS"], combine: "OR" })).sort()).toEqual([ids.indiaTaggedJobs, ids.ukNews].sort());
  });
  it("facets offer only values that exist, in the stored vocabulary", async () => {
    const f = await getFilterFacets(ctx);
    expect(f.seniorities.sort()).toEqual(["c_level", "manager"]);
    expect(f.countries).toEqual(["India", "United Kingdom"]);
    expect(f.tags).toEqual(["imported", "priority"]);
    expect(f.sources.sort()).toEqual(["JOB_BOARD", "NEWS"]);
    expect(await run({ seniorities: [f.seniorities[0]] })).toHaveLength(1);
  });
});

describe("filter contract", () => {
  it("names reversed ranges instead of silently matching nothing", () => {
    expect(filterProblems({ minScore: 8, maxScore: 3 })).toHaveLength(1);
    expect(filterProblems({ employeeMin: 500, employeeMax: 50 })[0]).toMatch(/Company size/);
    expect(filterProblems({ surfacedFrom: "2026-09-10", surfacedTo: "2026-09-01" })[0]).toMatch(/after/);
    expect(filterProblems({ minScore: 3, maxScore: 8 })).toEqual([]);
  });
  it("drops a negative or malformed value from a hand-edited URL and keeps the rest", () => {
    const { filter } = parseLeadParams({ employeeMin: "-5", surfacedFrom: "yesterday", countries: "India", tiers: "A" });
    expect(filter.employeeMin).toBeUndefined();
    expect(filter.surfacedFrom).toBeUndefined();
    expect(filter.countries).toEqual(["India"]);
    expect(filter.tiers).toEqual(["A"]);
  });
  it("round-trips every new field through the URL", () => {
    const stored = leadFilterSchema.parse({ countries: ["India"], tags: ["priority"], sources: ["JOB_BOARD"], surfacedFrom: "2026-09-01", surfacedTo: "2026-09-30" });
    const { filter } = parseLeadParams(Object.fromEntries(new URLSearchParams(buildLeadQuery(stored).slice(1))));
    expect(filter).toEqual(stored);
  });
});

describe("pagination", () => {
  it("is stable across pages when every row ties on the sort key", async () => {
    const w = await makeWorkspace("FilterPages");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const same = new Date("2026-09-01T10:00:00Z");
    for (let i = 0; i < 25; i++) {
      const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
      await db.lead.update({ where: { id: lead.id }, data: { surfacedAt: same } });
    }
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const r = await listLeads(w.ctx, leadFilterSchema.parse({ sort: "surfaced", pageSize: 10, page }));
      seen.push(...r.rows.map((x: { id: string }) => x.id));
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });
});
