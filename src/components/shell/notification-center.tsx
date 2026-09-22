"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAge } from "@/lib/format";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  severity: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

const SEVERITY_DOT: Record<string, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function NotificationCenter({ count }: { count: number }) {
  const [open, setOpen] = React.useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error("failed");
      return (await res.json()) as { notifications: Notification[]; unread: number };
    },
    enabled: open,
  });

  const unread = data?.unread ?? count;

  async function markAllRead() {
    await fetch("/api/notifications/read-all", { method: "POST" });
    void refetch();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Notifications">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            <Bell />
            {unread > 0 ? (
              <span className="absolute right-1 top-1 flex size-1.5 rounded-full bg-brand" aria-hidden />
            ) : null}
          </Button>
        </PopoverTrigger>
      </Tooltip>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
          <span className="text-xs font-semibold text-primary">
            Notifications
            {unread > 0 ? <span className="ml-1.5 text-muted tabular">{unread} new</span> : null}
          </span>
          {unread > 0 ? (
            <Button variant="ghost" size="xs" onClick={markAllRead}>
              <Check />
              Mark all read
            </Button>
          ) : null}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-full" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <ErrorState
              compact
              title="Couldn't load notifications"
              description="Your notifications are safe — we just couldn't fetch them."
              onRetry={() => void refetch()}
            />
          ) : !data?.notifications.length ? (
            <EmptyState
              compact
              icon={Bell}
              title="Nothing needs you"
              description="New replies, hot signals and deal risks will appear here."
            />
          ) : (
            <ul className="divide-hairline">
              {data.notifications.map((n) => {
                const body = (
                  <>
                    <span
                      className={cn(
                        "mt-1 size-1.5 shrink-0 rounded-full",
                        SEVERITY_DOT[n.severity] ?? "bg-border-strong"
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-primary">{n.title}</span>
                      <span className="mt-0.5 block text-2xs leading-relaxed text-secondary">{n.body}</span>
                      <span className="mt-1 block text-2xs text-muted">{formatAge(n.createdAt)}</span>
                    </span>
                  </>
                );
                const shell = cn(
                  "flex gap-2.5 px-3 py-2.5 transition-colors",
                  !n.readAt && "bg-brand-subtle/30"
                );
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link href={n.href} className={cn(shell, "hover:bg-surface-hover")}>
                        {body}
                      </Link>
                    ) : (
                      <div className={shell}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border-subtle px-3 py-2">
          <Link
            href="/settings/notifications"
            className="text-2xs text-muted transition-colors hover:text-secondary"
          >
            Notification settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
