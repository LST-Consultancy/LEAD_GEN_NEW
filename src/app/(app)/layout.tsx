import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth/context";
import { getShellData } from "@/lib/services/shell";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth();
  const shell = await getShellData(ctx);

  // Read the sidebar preference server-side so the first paint is already in the
  // right state — no collapse/expand flash on navigation.
  const collapsed = (await cookies()).get("sr_sidebar")?.value === "1";

  return (
    <AppShell
      user={ctx.user}
      roleName={ctx.roleName}
      workspaces={ctx.workspaces}
      activeWorkspace={{
        id: ctx.workspaceId,
        name: ctx.workspace.name,
        slug: ctx.workspace.slug,
        roleName: ctx.roleName,
      }}
      autopilotMode={ctx.workspace.autopilotMode}
      counters={shell.counters}
      points={shell.points}
      initialCollapsed={collapsed}
    >
      {children}
    </AppShell>
  );
}
