import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { makeWorkspace, cleanup, db } from "./helpers/fixtures";
import { createApiKey } from "@/lib/services/api-keys";
import { POST } from "@/app/api/mcp/route";

const created = { workspaceIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
afterAll(async () => { await cleanup(created); await db.$disconnect(); });
const call = (body: unknown, key?: string) => POST(new NextRequest("http://localhost/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) }));

describe("the MCP endpoint", () => {
  it("speaks JSON-RPC over HTTP with a scoped key, serves read-only tools, and refuses the rest", async () => {
    const w = await makeWorkspace("Mcp"); created.workspaceIds.push(w.workspace.id); created.userIds.push(w.user.id); created.planIds.push(w.plan.id);
    const good = (await createApiKey(w.ctx, { name: "Claude", scopes: ["insights.read"] })).plaintext;
    const wrong = (await createApiKey(w.ctx, { name: "Leads only", scopes: ["leads.read"] })).plaintext;

    expect((await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).status).toBe(401);
    expect((await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, wrong)).status).toBe(403);
    expect((await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, "sr_live_not-a-real-key")).status).toBe(401);

    const init = await (await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, good)).json();
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "signalroom" } });
    expect((await call({ jsonrpc: "2.0", method: "notifications/initialized" }, good)).status).toBe(202);

    const list = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, good)).json();
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("get_today");
    expect(list.result.tools.every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(true);

    const today = await (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_today", arguments: {} } }, good)).json();
    expect(today.result).toMatchObject({ isError: false, content: [{ type: "text" }] });

    const { TOOLS } = await import("@/lib/ai/tools");
    const writeTool = TOOLS.find(t => t.riskClass === "WRITE")!;
    const write = await (await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: writeTool.name, arguments: {} } }, good)).json();
    expect(write.error.message).toMatch(/not offered over MCP/);
    expect(names).not.toContain(writeTool.name);
    const unknown = await (await call({ jsonrpc: "2.0", id: 5, method: "nope" }, good)).json();
    expect(unknown.error.code).toBe(-32601);

    const batch = await (await call([{ jsonrpc: "2.0", id: 6, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }], good)).json();
    expect(batch).toEqual([{ jsonrpc: "2.0", id: 6, result: {} }]);
  });
});
