import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getWorkspaceSettings } from "@/lib/services/workspace-settings";
import { WorkspaceSettingsView } from "@/components/admin/workspace-settings-view";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspaceSettingsPage() {
  const ctx = await requireAuth();
  const { workspace } = await getWorkspaceSettings(ctx);

  return (
    <WorkspaceSettingsView
      workspace={workspace}
      canManage={ctx.permissions.includes(PERMISSIONS.WORKSPACE_MANAGE)}
    />
  );
}
