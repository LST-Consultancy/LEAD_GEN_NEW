"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, Search, Settings, Sparkles, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { NotificationCenter } from "@/components/shell/notification-center";
import { findNavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { ShellUser } from "@/components/shell/types";

export function Topbar({
  user,
  roleName,
  notificationCount,
  onOpenPalette,
  onOpenCopilot,
  onOpenMobileNav,
  copilotOpen,
}: {
  user: ShellUser;
  roleName: string;
  notificationCount: number;
  onOpenPalette: () => void;
  onOpenCopilot: () => void;
  onOpenMobileNav: () => void;
  copilotOpen: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const current = findNavItem(pathname);
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/85 px-2 backdrop-blur-md sm:px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
      >
        <Menu />
      </Button>

      <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
        <h1 className="truncate text-sm font-semibold tracking-tight text-primary">
          {current?.label ?? "Signalroom"}
        </h1>
        {current?.status === "planned" ? (
          <span className="rounded border border-border bg-surface-sunken px-1 text-2xs font-medium text-muted">
            soon
          </span>
        ) : null}
      </div>

      {/* Global search trigger — the palette does the real work. */}
      <button
        type="button"
        onClick={onOpenPalette}
        className={cn(
          "ml-auto flex h-7 items-center gap-2 rounded-md border border-border bg-surface-sunken px-2 text-xs text-muted transition-colors duration-150",
          "hover:border-border-strong hover:text-secondary",
          "w-7 justify-center sm:w-56 sm:justify-start md:w-64"
        )}
        aria-label="Search everything"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="hidden flex-1 text-left sm:inline">Search everything</span>
        <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <Tooltip content={<>Ask Copilot <Kbd className="ml-1">⌘I</Kbd></>}>
        <Button
          variant={copilotOpen ? "ai" : "ghost"}
          size="icon-sm"
          onClick={onOpenCopilot}
          aria-label="Ask Copilot"
          aria-pressed={copilotOpen}
        >
          <Sparkles className={copilotOpen ? "text-ai-accent" : undefined} />
        </Button>
      </Tooltip>

      <NotificationCenter count={notificationCount} />
      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Account menu"
        >
          <Avatar name={user.name} src={user.avatarUrl} size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="normal-case tracking-normal">
            <span className="block truncate text-xs font-semibold text-primary">{user.name}</span>
            <span className="block truncate text-2xs font-normal text-muted">{user.email}</span>
            <span className="mt-1 inline-block rounded border border-border bg-surface-sunken px-1 text-2xs font-medium text-secondary">
              {roleName}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/account">
              <UserIcon />
              Account
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            disabled={signingOut}
            onSelect={(e) => {
              e.preventDefault();
              void signOut();
            }}
          >
            <LogOut />
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
