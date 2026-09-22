"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CompanyAvatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ShellWorkspace } from "@/components/shell/types";

export function WorkspaceSwitcher({
  workspaces,
  active,
}: {
  workspaces: ShellWorkspace[];
  active: ShellWorkspace;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  async function switchTo(id: string) {
    if (id === active.id) return;
    setPending(id);
    try {
      const res = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: id }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      toast.error("Couldn't switch workspace", {
        description: "Your current workspace is unchanged. Please try again.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors duration-150",
          "hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring outline-none"
        )}
      >
        <CompanyAvatar name={active.name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-primary">{active.name}</span>
          <span className="block truncate text-2xs text-muted">{active.roleName}</span>
        </span>
        <ChevronDown className="size-3 shrink-0 text-muted" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onSelect={(e) => {
              e.preventDefault();
              void switchTo(w.id);
            }}
            disabled={pending !== null}
            className="gap-2"
          >
            <CompanyAvatar name={w.name} size="xs" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-primary">{w.name}</span>
              <span className="block truncate text-2xs text-muted">{w.roleName}</span>
            </span>
            {w.id === active.id ? <Check className="size-3.5 text-brand" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/onboarding")}>
          <Plus />
          New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
