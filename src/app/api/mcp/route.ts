import { NextResponse, type NextRequest } from "next/server";
import { resolveCaller } from "@/lib/api/caller";
import { apiError } from "@/lib/api/respond";
import { handleMcpMessage, MCP_SCOPE } from "@/lib/mcp/server";

/**
 * MCP Streamable HTTP endpoint. Authenticated by a workspace API key holding insights.read, never
 * a browser session: an MCP client is a machine caller. JSON-RPC batches are answered as arrays.
 */
export async function POST(req: NextRequest) {
  if (!req.headers.get("authorization")?.startsWith("Bearer ") && !req.headers.has("x-api-key")) return apiError("unauthorized", "MCP needs a workspace API key (Settings → API keys) with the insights.read scope, sent as a Bearer token.", 401);
  const caller = await resolveCaller(req.headers, { scope: MCP_SCOPE });
  if (!caller.ok) return caller.response;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: the body is not JSON." } }, { status: 400 }); }
  const messages = Array.isArray(body) ? body : [body];
  if (!messages.length || messages.length > 50) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Send between 1 and 50 messages." } }, { status: 400 });
  const replies = (await Promise.all(messages.map(m => handleMcpMessage(caller.ctx, (m ?? {}) as Record<string, unknown>)))).filter(r => r !== null);
  if (!replies.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? replies : replies[0], { headers: { "Cache-Control": "no-store" } });
}

/** This server sends no server-initiated messages, so there is no event stream to open. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
