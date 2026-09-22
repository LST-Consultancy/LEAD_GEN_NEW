import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getWorkspaceSettings } from "@/lib/services/workspace-settings";
import { PrivacyView } from "@/components/admin/privacy-view";

export const metadata: Metadata = { title: "Data & Privacy" };

export default async function PrivacyPage() {
  const ctx = await requireAuth();
  const { workspace, archivedCount, pendingPurge, leadCount } = await getWorkspaceSettings(ctx);

  return (
    <PrivacyView
      archiveAfterDays={workspace.archiveAfterDays}
      recycleBinDays={workspace.recycleBinDays}
      archivedCount={archivedCount}
      pendingPurge={pendingPurge}
      leadCount={leadCount}
      canManage={ctx.permissions.includes(PERMISSIONS.WORKSPACE_MANAGE)}
    />
  );
}
