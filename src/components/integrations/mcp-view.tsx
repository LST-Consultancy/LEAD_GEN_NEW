"use client";

import { AlertTriangle, Copy, Info, Plug, Shield, Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Tool = { name: string; riskClass: string; description: string; implemented: boolean };
type Scope = { key: string; label: string; risk: string; describes: string };

const RISK_VARIANT: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  READ: "neutral",
  WRITE: "info",
  SPEND: "warning",
  EXTERNAL: "danger",
};

/**
 * The MCP surface.
 *
 * The honest position: this app does not run an MCP server yet. What it does
 * have — and what an MCP server would expose verbatim — is the tool registry,
 * its risk classes, the scope model and the API key authentication. Showing
 * that manifest is useful and true; claiming a connectable server is not.
 */
export function McpView({
  tools,
  scopes,
  serverRunning,
  baseUrl,
}: {
  tools: Tool[];
  scopes: Scope[];
  serverRunning: boolean;
  baseUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const built = tools.filter((t) => t.implemented);

  const config = JSON.stringify(
    {
      mcpServers: {
        signalroom: {
          url: `${baseUrl}/api/mcp`,
          headers: { Authorization: "Bearer sr_live_…" },
        },
      },
    },
    null,
    2
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">MCP</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Operate this workspace from Claude, Claude Code, Cursor and other MCP clients — under
          the same scopes, permissions and audit trail as anything else.
        </p>
      </div>

      {!serverRunning ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>No MCP server is running yet</strong>, so there is nothing to connect a client
          to. Everything an MCP server would expose already exists and is listed below — the
          tools, their risk classes, the scope model and key authentication. The remaining work
          is the transport, not the permission model.
        </div>
      ) : (
        <div className="space-y-1 rounded-lg border border-border px-3 py-2.5 text-xs text-secondary">
          <p><strong className="text-primary">The MCP server is running</strong> at <code className="font-mono text-primary">{baseUrl}/api/mcp</code> (Streamable HTTP, JSON-RPC 2.0).</p>
          <p>Authenticate with a workspace API key holding <code className="font-mono">insights.read</code>, sent as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. Only the read-only tools below are offered; tools that change data or spend credits stay in Autopilot, where approvals apply.</p>
          <pre className="overflow-x-auto rounded bg-surface-sunken p-2 font-mono text-2xs">{`claude mcp add --transport http signalroom ${baseUrl}/api/mcp --header "Authorization: Bearer <key>"`}</pre>
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>What a client gets</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {built.filter((t) => t.riskClass === "READ").length} read-only tools are served over MCP. The rest are listed for reference: WRITE and SPEND tools run only in Autopilot, and tools marked not built are never advertised.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border-subtle">
            {tools.map((t) => (
              <li key={t.name} className="flex flex-wrap items-baseline gap-2 px-4 py-2">
                <code
                  className={cn(
                    "font-mono text-2xs",
                    t.implemented ? "text-primary" : "text-muted line-through"
                  )}
                >
                  {t.name}
                </code>
                <Badge variant={RISK_VARIANT[t.riskClass] ?? "neutral"} size="sm">
                  {t.riskClass}
                </Badge>
                {!t.implemented ? (
                  <Tooltip content="Declared but not built. It would not be advertised.">
                    <span className="cursor-help">
                      <Badge variant="neutral" size="sm">
                        Not built
                      </Badge>
                    </span>
                  </Tooltip>
                ) : null}
                <span className="min-w-0 flex-1 text-2xs text-secondary">{t.description}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>How access works</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              The same scopes an API key uses. A client is never more privileged than the key it
              presents, and that key is never more privileged than the person who created it.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1.5">
            {scopes.map((s) => (
              <li key={s.key} className="flex flex-wrap items-baseline gap-2">
                <code className="font-mono text-2xs text-primary">{s.key}</code>
                <Badge variant={RISK_VARIANT[s.risk] ?? "neutral"} size="sm">
                  {s.risk}
                </Badge>
                <span className="min-w-0 flex-1 text-2xs text-secondary">{s.describes}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-md border border-border-subtle bg-surface-sunken p-2.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-2xs font-semibold uppercase tracking-wider text-muted">
                <Terminal className="mr-0.5 inline size-2.5" />
                What the client config will look like
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(config);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}
              >
                <Copy />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="overflow-x-auto font-mono text-2xs text-secondary">{config}</pre>
            <p className="mt-1 text-2xs text-warning-text">
              <Info className="mr-0.5 inline size-2.5" />
              Shown so you can see the shape. The endpoint does not exist yet, so pasting this
              into a client will fail to connect.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What already holds, and will keep holding</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1.5">
            {[
              "Every call runs through the same services a person's click does — same permission check, same tenant scoping, same audit row.",
              "A tool is never a second way into the database. There is no machine-only code path to keep in sync.",
              "Risk classes carry through: a SPEND tool costs points and is subject to the same approval rules as an agent's.",
              "A key cannot exceed the person who issued it, and narrows automatically if they are demoted.",
            ].map((line, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-secondary">
                <Shield className="mt-0.5 size-3 shrink-0 text-muted" />
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-2xs text-muted">
            <Plug className="mr-0.5 inline size-2.5" />
            Issue a credential on{" "}
            <Link href="/settings/api-keys" className="text-accent-text hover:underline">
              API Keys
            </Link>{" "}
            — the same one an MCP client will use.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
