"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, Inbox, ListChecks, MoreHorizontal, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShellCounters } from "@/components/shell/types";

const TABS = [
  { key: "today", label: "Today", href: "/today", icon: Gauge, counter: null },
  { key: "leads", label: "Leads", href: "/leads", icon: Target, counter: null },
  { key: "inbox", label: "Inbox", href: "/inbox", icon: Inbox, counter: "inbox" as const },
  { key: "queue", label: "Queue", href: "/my-queue", icon: ListChecks, counter: "queue" as const },
];

/**
 * §95 — mobile is not a collapsed desktop. The bottom bar exposes only the four
 * workflows that make sense on a phone, plus everything else behind More.
 */
export function MobileTabBar({
  counters,
  onOpenMore,
}: {
  counters: ShellCounters;
  onOpenMore: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const count = tab.counter ? counters[tab.counter] : 0;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors",
              active ? "text-brand" : "text-muted"
            )}
          >
            <tab.icon className="size-4.5" />
            {tab.label}
            {count > 0 ? (
              <span className="absolute right-[22%] top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-semibold text-brand-fg tabular">
                {count > 9 ? "9+" : count}
              </span>
            ) : null}
            {active ? (
              <span className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-brand" aria-hidden />
            ) : null}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onOpenMore}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-2xs font-medium text-muted"
      >
        <MoreHorizontal className="size-4.5" />
        More
      </button>
    </nav>
  );
}
