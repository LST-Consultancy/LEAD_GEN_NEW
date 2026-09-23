import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { generateDailyBrief, parseBrief } from "@/lib/ai/daily-brief";

/**
 * The Today screen's deterministic Copilot brief is deliberately not generated
 * prose (see its own comment) — every clause is a counted fact with a link.
 * `generateDailyBrief` is the complement: one sentence of prose saying which
 * fact to act on first, grounded in the exact same counts, never a new one.
 */

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

afterAll(async () => {
  await cleanup(created);
  await db.$disconnect();
});

describe("parseBrief", () => {
  it("parses a plain JSON object", () => {
    expect(parseBrief('{"title": "A", "body": "B"}')).toEqual({ title: "A", body: "B" });
  });

  it("tolerates a fenced code block", () => {
    expect(parseBrief('```json\n{"title": "A", "body": "B"}\n```')).toEqual({ title: "A", body: "B" });
  });

  it("rejects a reply missing a title or body", () => {
    expect(parseBrief('{"title": "A"}')).toBeNull();
    expect(parseBrief('{"body": "B"}')).toBeNull();
  });

  it("rejects text that is not JSON", () => {
    expect(parseBrief("Sure, here you go.")).toBeNull();
  });
});

describe("generateDailyBrief", () => {
  it("writes nothing and calls no model on a quiet day", async () => {
    const { workspace, user } = await makeWorkspace("Brief");
    created.workspaceIds.push(workspace.id);
    created.userIds.push(user.id);

    const result = await generateDailyBrief(workspace.id, user.id);
    expect(result).toEqual({ ok: true, created: false, reason: "nothing_changed" });

    const rows = await db.aIInsight.findMany({ where: { workspaceId: workspace.id, kind: "DAILY_BRIEF" } });
    expect(rows).toHaveLength(0);
  });

  it("scopes a non-view-all member to their own leads, not the whole workspace", async () => {
    const { ctx, workspace } = await makeWorkspace("BriefScope", "owner");
    created.workspaceIds.push(workspace.id);
    created.userIds.push(ctx.userId);

    // A rep with leads.view_own only, and no signals of their own.
    const repCtx = await addMember(workspace.id, "BriefScopeRep", "sales_rep");
    created.userIds.push(repCtx.userId);

    // A hot lead exists, but it is owned by the owner, not the rep.
    const { lead } = await makeLead(workspace.id, { ownerId: ctx.userId, tier: "A", intent: "HOT" });
    await db.signal.create({
      data: {
        workspaceId: workspace.id,
        leadId: lead.id,
        type: "RFP",
        sourceKind: "TENDER_PORTAL",
        sourceName: "Test",
        title: "Signal",
        excerpt: "x",
        occurredAt: new Date(),
        detectedAt: new Date(),
        dedupeHash: `brief-scope-${lead.id}`,
      },
    });

    const repResult = await generateDailyBrief(workspace.id, repCtx.userId);
    expect(repResult).toEqual({ ok: true, created: false, reason: "nothing_changed" });
  });
});
