import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { listLeads, getShortcutCounts, getFilterFacets } from "@/lib/services/leads";
import { leadFilterSchema } from "@/lib/leads/filter";
import { getLeadDossier } from "@/lib/services/lead-detail";
import { getPipelineBoard, moveDeal, DealMoveError } from "@/lib/services/pipeline";
import { leadVisibilityFilter } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";

const DEFAULT_FILTER = leadFilterSchema.parse({});

let alpha: Awaited<ReturnType<typeof makeWorkspace>>;
let beta: Awaited<ReturnType<typeof makeWorkspace>>;
let alphaLeadId: string;
let betaLeadId: string;

beforeAll(async () => {
  alpha = await makeWorkspace("Alpha");
  beta = await makeWorkspace("Beta");

  const a = await makeLead(alpha.workspace.id, {
    name: "Alpha Person",
    companyName: "Alpha Industries",
    score: 9,
    tier: "A",
  });
  const b = await makeLead(beta.workspace.id, {
    name: "Beta Person",
    companyName: "Beta Industries",
    score: 9,
    tier: "A",
  });
  alphaLeadId = a.lead.id;
  betaLeadId = b.lead.id;
});

afterAll(async () => {
  await cleanup({
    workspaceIds: [alpha.workspace.id, beta.workspace.id],
    userIds: [alpha.user.id, beta.user.id],
    planIds: [alpha.plan.id, beta.plan.id],
  });
  await db.$disconnect();
});

describe("tenant isolation — enforced in SQL, not in the UI", () => {
  it("lists only the caller's own workspace leads", async () => {
    const result = await listLeads(alpha.ctx, DEFAULT_FILTER);
    const names = result.rows.map((r) => r.person.name);

    expect(names).toContain("Alpha Person");
    expect(names).not.toContain("Beta Person");
    expect(result.rows.every((r) => r.id !== betaLeadId)).toBe(true);
  });

  it("refuses to open another workspace's lead by id", async () => {
    // Alpha asking for Beta's lead must be indistinguishable from not found.
    await expect(getLeadDossier(alpha.ctx, betaLeadId)).resolves.toBeNull();
    await expect(getLeadDossier(beta.ctx, alphaLeadId)).resolves.toBeNull();

    // But each can read its own.
    await expect(getLeadDossier(alpha.ctx, alphaLeadId)).resolves.not.toBeNull();
    await expect(getLeadDossier(beta.ctx, betaLeadId)).resolves.not.toBeNull();
  });

  it("keeps shortcut counts scoped to the workspace", async () => {
    const counts = await getShortcutCounts(alpha.ctx);
    // Alpha has exactly one lead, scoring 9, so at most one can match anything.
    for (const [key, value] of Object.entries(counts)) {
      expect(value, `${key} leaked rows`).toBeLessThanOrEqual(1);
    }
  });

  it("keeps filter facets scoped to the workspace", async () => {
    const facets = await getFilterFacets(alpha.ctx);
    expect(facets.owners.map((o) => o.id)).toEqual([alpha.user.id]);
    expect(facets.owners.map((o) => o.id)).not.toContain(beta.user.id);
  });

  it("does not expose another workspace's pipeline", async () => {
    const pipeline = await db.pipeline.create({
      data: { workspaceId: beta.workspace.id, name: "Beta pipeline", isDefault: true },
    });
    await db.pipelineStage.create({
      data: {
        workspaceId: beta.workspace.id,
        pipelineId: pipeline.id,
        key: "new",
        name: "New",
        sortOrder: 0,
      },
    });

    // Alpha has no pipeline of its own, and must not inherit Beta's.
    await expect(getPipelineBoard(alpha.ctx)).resolves.toBeNull();
    // Nor by asking for it explicitly.
    await expect(getPipelineBoard(alpha.ctx, pipeline.id)).resolves.toBeNull();
    await expect(getPipelineBoard(beta.ctx)).resolves.not.toBeNull();
  });

  it("refuses to move another workspace's deal", async () => {
    const pipeline = await db.pipeline.findFirstOrThrow({
      where: { workspaceId: beta.workspace.id },
    });
    const stage = await db.pipelineStage.findFirstOrThrow({
      where: { pipelineId: pipeline.id },
    });
    const betaCompany = await db.company.findFirstOrThrow({
      where: { workspaceId: beta.workspace.id },
    });
    const deal = await db.deal.create({
      data: {
        workspaceId: beta.workspace.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        companyId: betaCompany.id,
        title: "Beta deal",
        valueInr: 100000,
      },
    });

    await expect(
      moveDeal(alpha.ctx, { dealId: deal.id, toStageId: stage.id })
    ).rejects.toThrow(DealMoveError);
  });
});

describe("row-level visibility — reps see only their own leads", () => {
  it("scopes a sales rep to leads they own", async () => {
    const rep = await addMember(alpha.workspace.id, "Rep", "sales_rep");
    const manager = await addMember(alpha.workspace.id, "Manager", "manager");

    await makeLead(alpha.workspace.id, { name: "Rep Owned", ownerId: rep.userId });
    await makeLead(alpha.workspace.id, { name: "Manager Owned", ownerId: manager.userId });

    // The rep's role deliberately lacks LEADS_VIEW_ALL.
    expect(rep.permissions).not.toContain(PERMISSIONS.LEADS_VIEW_ALL);
    expect(manager.permissions).toContain(PERMISSIONS.LEADS_VIEW_ALL);

    const repView = await listLeads(rep, DEFAULT_FILTER);
    const repNames = repView.rows.map((r) => r.person.name);
    expect(repNames).toContain("Rep Owned");
    expect(repNames).not.toContain("Manager Owned");

    const managerView = await listLeads(manager, DEFAULT_FILTER);
    const managerNames = managerView.rows.map((r) => r.person.name);
    expect(managerNames).toContain("Rep Owned");
    expect(managerNames).toContain("Manager Owned");
  });

  it("returns a SQL fragment, so the restriction cannot be bypassed client-side", async () => {
    const rep = await addMember(alpha.workspace.id, "Rep2", "sales_rep");
    const owner = alpha.ctx;

    expect(leadVisibilityFilter(rep)).toEqual({ ownerId: rep.userId });
    expect(leadVisibilityFilter(owner)).toEqual({});
  });

  it("hides another rep's lead even when asked for by id", async () => {
    const repA = await addMember(alpha.workspace.id, "RepA", "sales_rep");
    const repB = await addMember(alpha.workspace.id, "RepB", "sales_rep");
    const owned = await makeLead(alpha.workspace.id, {
      name: "RepA Only",
      ownerId: repA.userId,
    });

    await expect(getLeadDossier(repB, owned.lead.id)).resolves.toBeNull();
    await expect(getLeadDossier(repA, owned.lead.id)).resolves.not.toBeNull();
  });
});
