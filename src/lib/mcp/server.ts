import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import { TOOLS, type Tool } from "@/lib/ai/tools";

/**
 * A Model Context Protocol server over Streamable HTTP (JSON-RPC 2.0, one POST per message,
 * JSON responses). It serves the tools this product's own Copilot uses, READ tools only: those
 * answer from the workspace through the same services and visibility as the screens. WRITE and
 * SPEND tools stay inside Autopilot, where guardrails and approvals apply — an outside model is not
 * given a path around them.
 */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const MCP_SCOPE = "insights.read";
export const exposedTools = (): Tool[] => TOOLS.filter(t => t.riskClass === "READ" && t.implemented && t.run);

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Reply = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };
const ok = (id: Reply["id"], result: unknown): Reply => ({ jsonrpc: "2.0", id, result });
const fail = (id: Reply["id"], code: number, message: string): Reply => ({ jsonrpc: "2.0", id, error: { code, message } });

/** One JSON-RPC message. A notification (no id) returns null: the transport answers 202 with no body. */
export async function handleMcpMessage(ctx: AuthContext, msg: Rpc): Promise<Reply | null> {
  const id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return isNotification ? null : fail(id, -32600, "Invalid request: expected JSON-RPC 2.0 with a method.");
  const params = (msg.params ?? {}) as Record<string, unknown>;
  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSIONS[0];
      return ok(id, { protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "signalroom", version: "1.0.0" }, instructions: `Workspace ${ctx.workspace.name}. Read-only tools; answers come from this workspace's records, and each tool says when it has nothing to go on.` });
    }
    case "notifications/initialized": case "notifications/cancelled": return null;
    case "ping": return ok(id, {});
    case "tools/list":
      return ok(id, { tools: exposedTools().map(t => ({ name: t.name, description: t.description, inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } })) });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = exposedTools().find(t => t.name === name);
      if (!tool) {
        const declared = TOOLS.find(t => t.name === name);
        return fail(id, -32602, declared ? `${name} changes data or spends credits, so it is not offered over MCP; use it in Autopilot, where approvals apply.` : `There is no tool called ${name}.`);
      }
      try {
        const r = await tool.run!(ctx);
        const evidence = (r.evidence ?? []).map(e => `- ${e.label}${e.detail ? ` — ${e.detail}` : ""}${e.href ? ` (${e.href})` : ""}`).join("\n");
        return ok(id, { content: [{ type: "text", text: evidence ? `${r.text}\n\nEvidence:\n${evidence}` : r.text }], isError: false });
      } catch (e) {
        return ok(id, { content: [{ type: "text", text: e instanceof Error ? e.message : "The tool failed." }], isError: true });
      }
    }
    default: return isNotification ? null : fail(id, -32601, `Method not found: ${msg.method}`);
  }
}
