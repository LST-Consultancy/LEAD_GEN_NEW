import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, makeLead, addMember, cleanup } from "./helpers/fixtures";
import { getBattlecard } from "@/lib/services/battlecard";
import { buildDraftPrompt, CHANNEL_RULES, LANGUAGE_RULES } from "@/lib/outreach/draft-prompt";
import { draftInputSchema } from "@/lib/services/draft";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("battlecard", () => {
  it("cites a row for every point, puts relevant knowledge first, and names what is missing", async () => {
    const w = await makeWorkspace("Battlecard");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    await db.signal.create({ data: { workspaceId: w.workspace.id, leadId: lead.id, companyId: lead.companyId, type: "HIRING", sourceKind: "JOB_BOARD", sourceName: "Naukri", title: "Hiring a NetSuite administrator", excerpt: "Needs NetSuite migration help", keywords: [], dedupeHash: "bc-1", occurredAt: new Date() } });
    const general = await db.knowledgeDoc.create({ data: { workspaceId: w.workspace.id, kind: "service", title: "Payroll outsourcing", body: "Monthly payroll runs.", tags: [] } });
    const relevant = await db.knowledgeDoc.create({ data: { workspaceId: w.workspace.id, kind: "service", title: "NetSuite migration", body: "Fixed-scope NetSuite migrations in eight weeks.", tags: [] } });

    const card = await getBattlecard(w.ctx, lead.id);
    expect(card?.pain[0]).toMatchObject({ source: { kind: "signal", label: "Naukri" } });
    expect(card?.talkingPoints.map((p) => p.source.id)).toEqual([relevant.id, general.id]);
    expect(card?.talkingPoints[0].relevant).toBe(true);
    expect(card?.proof).toEqual([]);
    expect(card?.missing.join(" ")).toMatch(/Case study/);
    for (const section of [card!.pain, card!.talkingPoints]) for (const p of section) expect(p.source.id).toBeTruthy();
  });

  it("is null for a lead the caller cannot see", async () => {
    const w = await makeWorkspace("Battlecard2");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const rep = await addMember(w.workspace.id, "BcRep", "sales_rep"); created.userIds.push(rep.userId);
    const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
    expect(await getBattlecard(rep, lead.id)).toBeNull();
  });
});

describe("draft options", () => {
  it("defaults to English and says so in the prompt", () => {
    expect(draftInputSchema.parse({ leadId: "00000000-0000-4000-8000-000000000000", channel: "email" }).language).toBe("en");
    expect(buildDraftPrompt({ channel: "email", sections: [] })).toContain(`LANGUAGE: ${LANGUAGE_RULES.en.rule}`);
  });
  it("passes Hinglish and Hindi through, keeping placeholders and figures as written", () => {
    expect(buildDraftPrompt({ channel: "whatsapp", sections: [], language: "hinglish" })).toContain("Hinglish");
    expect(buildDraftPrompt({ channel: "whatsapp", sections: [], language: "hi" })).toContain("Devanagari");
  });
  it("has a spoken call opener channel with a word cap", () => {
    expect(CHANNEL_RULES.call.maxWords).toBeLessThanOrEqual(80);
    expect(buildDraftPrompt({ channel: "call", sections: [] })).toContain("Call opener");
    expect(() => draftInputSchema.parse({ leadId: "00000000-0000-4000-8000-000000000000", channel: "fax" })).toThrow();
  });
});
