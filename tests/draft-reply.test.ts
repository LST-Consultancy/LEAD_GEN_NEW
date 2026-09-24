import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ai/complete", async (original) => ({ ...(await original<typeof import("@/lib/ai/complete")>()), complete: vi.fn() }));
import { complete } from "@/lib/ai/complete";
import { db, makeWorkspace, makeLead, cleanup } from "./helpers/fixtures";
import { draftOutreach } from "@/lib/services/draft";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
beforeEach(() => vi.mocked(complete).mockReset());
const ok = (text: string) => ({ ok: true as const, text, model: "test-model", provider: "anthropic" as const, inputTokens: 1, outputTokens: 1, latencyMs: 1, estimatedCostInr: 0 });

async function setup() {
  const w = await makeWorkspace("DraftReply");
  created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
  await db.knowledgeDoc.create({ data: { workspaceId: w.workspace.id, kind: "service", title: "NetSuite migration", body: "Fixed-scope migrations in eight weeks.", tags: [] } });
  const { lead } = await makeLead(w.workspace.id, { ownerId: w.user.id });
  const convo = await db.conversation.create({ data: { workspaceId: w.workspace.id, channel: "EMAIL", leadId: lead.id, state: "OPEN" } as never });
  return { ...w, lead, convo };
}

describe("reply drafts", () => {
  it("puts the thread into the grounding and never sends anything", async () => {
    const w = await setup();
    await db.message.create({ data: { workspaceId: w.workspace.id, conversationId: w.convo.id, direction: "OUTBOUND", channel: "EMAIL", state: "SENT", body: "Worth a call about the migration?", actorType: "HUMAN" } as never });
    await db.message.create({ data: { workspaceId: w.workspace.id, conversationId: w.convo.id, direction: "INBOUND", channel: "EMAIL", state: "DELIVERED", body: "How long does it take?", actorType: "HUMAN" } as never });
    vi.mocked(complete).mockResolvedValue(ok(JSON.stringify({ subject: null, body: "Hi {{first_name}}, about eight weeks.", variablesUsed: ["first_name"], groundedOn: ["What you sell", "The conversation so far"], withheld: null })));
    const before = await db.message.count({ where: { workspaceId: w.workspace.id } });
    const r = await draftOutreach(w.ctx, { leadId: w.lead.id, channel: "email", conversationId: w.convo.id });
    expect(r.ok).toBe(true);
    const prompt = vi.mocked(complete).mock.calls[0][1].prompt as string;
    expect(prompt).toContain("## The conversation so far");
    expect(prompt).toContain("Them: How long does it take?");
    expect(await db.message.count({ where: { workspaceId: w.workspace.id } })).toBe(before);
  });

  it("refuses a thread they never answered, or one belonging to another lead, without calling the model", async () => {
    const w = await setup();
    await db.message.create({ data: { workspaceId: w.workspace.id, conversationId: w.convo.id, direction: "OUTBOUND", channel: "EMAIL", state: "SENT", body: "Hello", actorType: "HUMAN" } as never });
    expect(await draftOutreach(w.ctx, { leadId: w.lead.id, channel: "email", conversationId: w.convo.id })).toMatchObject({ ok: false, code: "no_grounding" });
    const other = await makeLead(w.workspace.id, { ownerId: w.user.id });
    expect(await draftOutreach(w.ctx, { leadId: other.lead.id, channel: "email", conversationId: w.convo.id })).toMatchObject({ ok: false, code: "lead_not_found" });
    expect(vi.mocked(complete)).not.toHaveBeenCalled();
  });
});
