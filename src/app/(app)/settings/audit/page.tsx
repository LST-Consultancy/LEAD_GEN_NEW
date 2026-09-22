import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Cog, ScrollText, Terminal, User, Webhook, Zap } from "lucide-react";
import { requireAuth, assertPermission } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getAuditLog } from "@/lib/services/settings";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit Log" };

const SOURCE_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; variant: "neutral" | "info" | "ai" | "warning" }
> = {
  UI: { label: "UI", icon: User, variant: "neutral" },
  API: { label: "API", icon: Terminal, variant: "info" },
  MCP: { label: "MCP", icon: Zap, variant: "ai" },
  AUTOPILOT: { label: "Autopilot", icon: Bot, variant: "ai" },
  INTEGRATION: { label: "Integration", icon: Webhook, variant: "info" },
  SYSTEM: { label: "System", icon: Cog, variant: "neutral" },
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; page?: string }>;
}) {
  const ctx = await requireAuth();
  // Reading the audit trail is itself a permission.
  assertPermission(ctx, PERMISSIONS.AUDIT_VIEW);

  const params = await searchParams;
  const { rows, total, page, pageCount, sources } = await getAuditLog(ctx, {
    source: params.source,
    page: params.page ? Number(params.page) : 1,
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-primary">Audit log</h1>
        <p className="mt-0.5 text-xs text-secondary">
          Every state change, with who did it and where it came from. AI and API actors are recorded
          the same way people are — that is the point.
        </p>
      </header>

      {/* Source filter */}
      <div className="flex flex-wrap gap-1.5">
        <Link
          href="/settings/audit"
          className={cn(
            "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
            !params.source
              ? "border-brand-border bg-brand-subtle text-brand-text"
              : "border-border bg-surface text-secondary hover:border-border-strong"
          )}
        >
          All sources
        </Link>
        {sources.map((s) => {
          const meta = SOURCE_META[s.source] ?? SOURCE_META.SYSTEM;
          const active = params.source === s.source;
          return (
            <Link
              key={s.source}
              href={`/settings/audit?source=${s.source}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-brand-border bg-brand-subtle text-brand-text"
                  : "border-border bg-surface text-secondary hover:border-border-strong"
              )}
            >
              <meta.icon className="size-3" />
              {meta.label}
              <span className="rounded bg-surface-sunken px-1 text-2xs tabular">{s.count}</span>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <ScrollText className="size-3.5" />
              Entries
            </CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {total} total · page {page} of {pageCount}
            </p>
          </div>
        </CardHeader>

        <CardContent className="p-0 pb-0">
          {rows.length === 0 ? (
            <EmptyState
              compact
              icon={ScrollText}
              title="No entries for this filter"
              description="Audit rows are written as actions happen. Try another source."
            />
          ) : (
            <ul className="divide-hairline border-t border-border-subtle">
              {rows.map((r) => {
                const meta = SOURCE_META[r.source] ?? SOURCE_META.SYSTEM;
                const changed =
                  r.before && r.after
                    ? diffSummary(
                        r.before as Record<string, unknown>,
                        r.after as Record<string, unknown>
                      )
                    : null;
                return (
                  <li key={r.id} className="flex gap-2.5 px-4 py-2.5">
                    <div className="mt-0.5 shrink-0">
                      {r.actorUser ? (
                        <Avatar name={r.actorUser.name} src={r.actorUser.avatarUrl} size="sm" />
                      ) : (
                        <span
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full border",
                            r.actorType === "AI"
                              ? "border-ai-border bg-ai-surface text-ai-accent"
                              : "border-border bg-surface-sunken text-muted"
                          )}
                        >
                          <meta.icon className="size-3" />
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-medium text-primary">
                          {r.action}
                        </span>
                        <Badge size="sm" variant={meta.variant}>
                          {meta.label}
                        </Badge>
                        {r.actorType === "AI" ? (
                          <Badge size="sm" variant="ai" uppercase>
                            AI
                          </Badge>
                        ) : null}
                      </div>

                      <p className="mt-0.5 text-2xs text-secondary">
                        <span className="font-medium">{r.actorLabel}</span> · {r.objectType}
                        {r.objectId ? (
                          <Tooltip content={r.objectId}>
                            <span className="ml-1 cursor-help font-mono text-muted">
                              {r.objectId.slice(0, 8)}
                            </span>
                          </Tooltip>
                        ) : null}
                      </p>

                      {changed ? (
                        <p className="mt-0.5 font-mono text-2xs text-muted">{changed}</p>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="whitespace-nowrap text-2xs text-muted">
                        {formatDateTime(r.createdAt, ctx.workspace.timezone)}
                      </p>
                      {r.ipAddress ? (
                        <p className="whitespace-nowrap font-mono text-2xs text-muted/70">
                          {r.ipAddress}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-2xs text-muted tabular">
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-1.5">
            {page > 1 ? (
              <Link
                href={`/settings/audit?${new URLSearchParams({ ...(params.source ? { source: params.source } : {}), page: String(page - 1) })}`}
                className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-secondary transition-colors hover:border-border-strong"
              >
                Previous
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link
                href={`/settings/audit?${new URLSearchParams({ ...(params.source ? { source: params.source } : {}), page: String(page + 1) })}`}
                className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-secondary transition-colors hover:border-border-strong"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Renders a compact "field: old → new" summary from the stored before/after. */
function diffSummary(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string | null {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const parts = keys
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .slice(0, 3)
    .map((k) => `${k}: ${String(before[k] ?? "—")} → ${String(after[k] ?? "—")}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
