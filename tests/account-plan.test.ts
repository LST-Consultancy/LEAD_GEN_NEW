import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, cleanup } from "./helpers/fixtures";
import { generateAccountPlan, parseSections } from "@/lib/ai/account-plan";

/**
 * The account plan is generated on demand and never persisted — the committee,
 * deals and signals it is grounded in already live in their own tables. The
 * guarantee is the same one `proposal_draft` uses: money is checked with the
 * lakh/crore-aware guard, everything else with the plain-number one, and the
 * two must never double-flag the same digit.
 */

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("parseSections", () => {
  it("parses a plain JSON object with all three sections", () => {
    const parsed = parseSections(
      '{"sections": [{"key": "stakeholders", "title": "A", "body": "B"}, {"key": "strategy", "title": "C", "body": "D"}]}'
    );
    expect(parsed).toEqual([
      { key: "stakeholders", title: "A", body: "B" },
      { key: "strategy", title: "C", body: "D" },
    ]);
  });

  it("tolerates a fenced code block", () => {
    expect(parseSections('```json\n{"sections": [{"key": "a", "title": "T", "body": "B"}]}\n```')).toEqual([
      { key: "a", title: "T", body: "B" },
    ]);
  });

  it("drops a section missing a key, title or body", () => {
    expect(
      parseSections('{"sections": [{"key": "a", "title": "T"}, {"key": "b", "title": "T2", "body": "B2"}]}')
    ).toEqual([{ key: "b", title: "T2", body: "B2" }]);
  });

  it("rejects an empty sections array", () => {
    expect(parseSections('{"sections": []}')).toBeNull();
  });

  it("rejects text that is not JSON", () => {
    expect(parseSections("Sure, here is a plan.")).toBeNull();
  });
});

describe("generateAccountPlan", () => {
  it("refuses an account that doesn't exist in this workspace", async () => {
    const { ctx, workspace } = await makeWorkspace("PlanNotFound");
    created.workspaceIds.push(workspace.id);
    created.userIds.push(ctx.userId);

    const result = await generateAccountPlan(ctx, { companyId: "00000000-0000-0000-0000-000000000000" });
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      reason: "That account doesn't exist, or you don't have access to it.",
    });
  });

  it("refuses an account with no mapped committee and no open deal", async () => {
    const { ctx, workspace } = await makeWorkspace("PlanEmpty");
    created.workspaceIds.push(workspace.id);
    created.userIds.push(ctx.userId);

    const company = await db.company.create({
      data: { workspaceId: workspace.id, name: "Bare Co", domain: "bare.invalid" },
    });

    const result = await generateAccountPlan(ctx, { companyId: company.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no_committee_or_deal");
  });

  it("stays inside its own workspace", async () => {
    const a = await makeWorkspace("PlanTenantA");
    const b = await makeWorkspace("PlanTenantB");
    created.workspaceIds.push(a.workspace.id, b.workspace.id);
    created.userIds.push(a.ctx.userId, b.ctx.userId);

    const companyInB = await db.company.create({
      data: { workspaceId: b.workspace.id, name: "Other tenant's account", domain: "otherb.invalid" },
    });

    const result = await generateAccountPlan(a.ctx, { companyId: companyInB.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });
});
