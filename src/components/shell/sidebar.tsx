"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Plane, Zap } from "lucide-react";
import { NAV, type NavItem } from "@/lib/nav";
import { AUTOPILOT_MODE } from "@/lib/vocab";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { Tooltip } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { Brandmark } from "@/components/shell/brandmark";
import type { PointsSummary, ShellCounters, ShellWorkspace } from "@/components/shell/types";

export function Sidebar({
  collapsed,
  onToggle,
  counters,
  workspaces,
  activeWorkspace,
  autopilotMode,
  points,
  className,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  counters: ShellCounters;
  workspaces: ShellWorkspace[];
  activeWorkspace: ShellWorkspace;
  autopilotMode: string;
  points: PointsSummary;
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const autopilot = AUTOPILOT_MODE[autopilotMode] ?? AUTOPILOT_MODE.OFF;

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r border-border bg-surface-sunken",
        collapsed ? "w-[52px]" : "w-[228px]",
        "transition-[width] duration-200 ease-out",
        className
      )}
      data-collapsed={collapsed}
    >
      {/* Brand + workspace */}
      <div className={cn("flex shrink-0 items-center gap-2 px-2.5 pt-3 pb-2", collapsed && "justify-center px-1.5")}>
        {collapsed ? (
          <Tooltip content={activeWorkspace.name} side="right">
            <Link href="/today" aria-label="Signalroom home" className="rounded-md p-0.5">
              <Brandmark className="size-6" />
            </Link>
          </Tooltip>
        ) : (
          <WorkspaceSwitcher workspaces={workspaces} active={activeWorkspace} />
        )}
      </div>

      {/* Nav groups */}
      <nav
        aria-label="Main navigation"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-2 pb-3 scrollbar-none"
      >
        {NAV.map((group) => (
          <div key={group.key}>
            {collapsed ? (
              <div className="mx-auto mb-1.5 h-px w-5 bg-border" aria-hidden />
            ) : (
              <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wider text-muted">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <SidebarLink
                  key={item.key}
                  item={item}
                  collapsed={collapsed}
                  active={isActive(pathname, item)}
                  count={item.counter ? counters[item.counter] : undefined}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer: autopilot + points + collapse */}
      <div className="shrink-0 space-y-2 border-t border-border px-2 py-2">
        <AutopilotChip collapsed={collapsed} mode={autopilotMode} label={autopilot.short} description={autopilot.description} />
        <PointsMeter collapsed={collapsed} points={points} />

        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={cn(
            "flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-secondary",
            collapsed && "justify-center px-0"
          )}
        >
          {collapsed ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  );
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/settings") return pathname === "/settings";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function SidebarLink({
  item,
  collapsed,
  active,
  count,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  count?: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const planned = item.status === "planned";

  const body = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-7 items-center gap-2 rounded-md px-2 text-xs font-medium transition-colors duration-150",
        active
          ? "bg-surface text-primary shadow-card"
          : "text-secondary hover:bg-surface-hover hover:text-primary",
        collapsed && "justify-center px-0"
      )}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-brand" aria-hidden />
      ) : null}
      <Icon
        className={cn(
          "size-3.5 shrink-0 transition-colors",
          active ? "text-brand" : "text-muted group-hover:text-secondary"
        )}
      />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {count !== undefined && count > 0 ? (
            <span
              className={cn(
                "ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-2xs font-semibold tabular",
                item.counter === "approvals" || item.counter === "inbox"
                  ? "bg-brand text-brand-fg"
                  : "bg-surface-active text-secondary"
              )}
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : planned ? (
            <span
              className="size-1 shrink-0 rounded-full bg-border-strong"
              aria-label="Not built yet"
              title="Not built yet"
            />
          ) : null}
        </>
      )}
      {collapsed && count !== undefined && count > 0 ? (
        <span className="absolute right-1 top-1 size-1.5 rounded-full bg-brand" aria-hidden />
      ) : null}
    </Link>
  );

  return (
    <li>
      {collapsed ? (
        <Tooltip
          side="right"
          content={
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 font-medium text-primary">
                {item.label}
                {count ? <span className="text-brand-text tabular">{count}</span> : null}
              </div>
              <div className="text-muted">{item.purpose}</div>
            </div>
          }
        >
          {body}
        </Tooltip>
      ) : (
        body
      )}
    </li>
  );
}

function AutopilotChip({
  collapsed,
  mode,
  label,
  description,
}: {
  collapsed: boolean;
  mode: string;
  label: string;
  description: string;
}) {
  const tone =
    mode === "FULL_AUTO"
      ? "border-success-border bg-success-subtle text-success-text"
      : mode === "REVIEW_FIRST"
        ? "border-warning-border bg-warning-subtle text-warning-text"
        : "border-border bg-surface text-muted";

  const chip = (
    <Link
      href="/autopilot"
      className={cn(
        "flex h-7 items-center gap-2 rounded-md border px-2 text-2xs font-semibold uppercase tracking-wide transition-colors hover:brightness-[0.98]",
        tone,
        collapsed && "justify-center px-0"
      )}
    >
      <Plane className="size-3.5 shrink-0" />
      {!collapsed && <span className="truncate">Autopilot · {label}</span>}
    </Link>
  );

  return (
    <Tooltip side="right" content={<><strong>Autopilot</strong> — {description}</>}>
      {chip}
    </Tooltip>
  );
}

function PointsMeter({
  collapsed,
  points,
}: {
  collapsed: boolean;
  points: PointsSummary;
}) {
  const { balance, monthlyAllowance, averagePerDay, daysRemaining } = points;
  // The bar tracks runway against a 30-day horizon, not balance against
  // allowance — a topped-up balance would otherwise read as untouched.
  const runwayPct = daysRemaining === null ? 100 : Math.min(100, (daysRemaining / 30) * 100);
  const low = daysRemaining !== null && daysRemaining < 10;

  const detail =
    daysRemaining === null
      ? "No spend recorded in the last 14 days."
      : `Spending ${averagePerDay} points a day on average, so this balance lasts about ${daysRemaining} days. Monthly allowance is ${formatNumber(monthlyAllowance)}.`;

  if (collapsed) {
    return (
      <Tooltip
        side="right"
        content={
          <>
            <strong>{formatNumber(balance)} points</strong>
            <div className="mt-0.5 text-muted">{detail}</div>
          </>
        }
      >
        <Link
          href="/settings/billing"
          className="flex h-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-secondary"
          aria-label={`${balance} points remaining`}
        >
          <Zap className={cn("size-3.5", low && "text-warning")} />
        </Link>
      </Tooltip>
    );
  }

  return (
    <Tooltip side="right" content={detail}>
      <Link
        href="/settings/billing"
        className="block space-y-1 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-muted">Points</span>
          <span className="text-2xs font-semibold text-secondary tabular">
            {formatNumber(balance)}
            {daysRemaining !== null ? (
              <span className={cn("ml-1 font-normal", low ? "text-warning-text" : "text-muted")}>
                ~{daysRemaining}d
              </span>
            ) : null}
          </span>
        </div>
        <Progress
          value={runwayPct}
          size="xs"
          label={
            daysRemaining !== null
              ? `${balance} points, about ${daysRemaining} days remaining`
              : `${balance} points remaining`
          }
          barClassName={low ? "bg-warning" : undefined}
        />
      </Link>
    </Tooltip>
  );
}
