import { afterAll, describe, expect, it } from "vitest";
import { db, makeWorkspace, addMember, cleanup } from "./helpers/fixtures";
import { provisionAgents } from "@/lib/services/autopilot";
import { AGENT_CATALOGUE } from "@/lib/autopilot/agent-catalogue";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });

describe("agent provisioning", () => {
  it("adds the catalogue switched off and review-first, never touches an existing agent, and is idempotent", async () => {
    const w = await makeWorkspace("Agents");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const configured = await db.aIAgent.create({ data: { workspaceId: w.workspace.id, kind: "SDR", name: "Our SDR", goal: "custom", tools: ["draft_outreach"], isEnabled: true, approvalPolicy: "auto_within_budget" } });

    const first = await provisionAgents(w.ctx);
    expect(first.created).toBe(AGENT_CATALOGUE.length - 1);
    const agents = await db.aIAgent.findMany({ where: { workspaceId: w.workspace.id } });
    expect(agents).toHaveLength(AGENT_CATALOGUE.length);
    expect(agents.filter((a) => a.id !== configured.id).every((a) => !a.isEnabled && a.approvalPolicy === "review_first")).toBe(true);
    expect(await db.aIAgent.findUniqueOrThrow({ where: { id: configured.id } })).toMatchObject({ name: "Our SDR", isEnabled: true, approvalPolicy: "auto_within_budget" });

    expect((await provisionAgents(w.ctx)).created).toBe(0);
    expect(await db.aIAgent.count({ where: { workspaceId: w.workspace.id } })).toBe(AGENT_CATALOGUE.length);
  });

  it("needs agents.configure", async () => {
    const w = await makeWorkspace("Agents2");
    created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const rep = await addMember(w.workspace.id, "AgentRep", "sales_rep"); created.userIds.push(rep.userId);
    await expect(provisionAgents(rep)).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(await db.aIAgent.count({ where: { workspaceId: w.workspace.id } })).toBe(0);
  });
});
