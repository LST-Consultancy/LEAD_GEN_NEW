"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";
import { CopilotDrawer } from "@/components/shell/copilot-drawer";
import { MobileTabBar } from "@/components/shell/mobile-nav";
import type { PointsSummary, ShellCounters, ShellUser, ShellWorkspace } from "@/components/shell/types";

const SIDEBAR_COOKIE = "sr_sidebar";

export function AppShell({
  children,
  user,
  roleName,
  workspaces,
  activeWorkspace,
  autopilotMode,
  counters,
  points,
  initialCollapsed,
}: {
  children: React.ReactNode;
  user: ShellUser;
  roleName: string;
  workspaces: ShellWorkspace[];
  activeWorkspace: ShellWorkspace;
  autopilotMode: string;
  counters: ShellCounters;
  points: PointsSummary;
  initialCollapsed: boolean;
}) {
  const pathname = usePathname();
  // Seeded from a cookie on the server, so the first paint is already correct.
  const [collapsed, setCollapsed] = React.useState(initialCollapsed);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [copilotOpen, setCopilotOpen] = React.useState(false);
  const [copilotSeed, setCopilotSeed] = React.useState<string | undefined>();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }

  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setCopilotSeed(undefined);
        setCopilotOpen((o) => !o);
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openCopilot(seed?: string) {
    setCopilotSeed(seed);
    setCopilotOpen(true);
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden shrink-0 lg:block">
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleSidebar}
          counters={counters}
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          autopilotMode={autopilotMode}
          points={points}
        />
      </aside>

      {/* Mobile nav drawer */}
      <DialogPrimitive.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-40 w-[248px] outline-none lg:hidden">
            <VisuallyHidden>
              <DialogPrimitive.Title>Navigation</DialogPrimitive.Title>
            </VisuallyHidden>
            <Sidebar
              collapsed={false}
              onToggle={() => setMobileNavOpen(false)}
              counters={counters}
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              autopilotMode={autopilotMode}
              points={points}
              onNavigate={() => setMobileNavOpen(false)}
              className="h-full w-full"
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          roleName={roleName}
          notificationCount={counters.notifications}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenCopilot={() => openCopilot()}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          copilotOpen={copilotOpen}
        />

        <main id="main" className="min-h-0 flex-1 overflow-y-auto pb-14 lg:pb-0">
          {children}
        </main>
      </div>

      <MobileTabBar counters={counters} onOpenMore={() => setMobileNavOpen(true)} />

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenCopilot={openCopilot} />
      <CopilotDrawer open={copilotOpen} onOpenChange={setCopilotOpen} seed={copilotSeed} />
    </div>
  );
}
