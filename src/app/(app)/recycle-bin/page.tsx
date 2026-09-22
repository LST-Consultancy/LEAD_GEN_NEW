import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listRecycleBin } from "@/lib/services/recycle-bin";
import { RecycleBinView } from "@/components/admin/recycle-bin-view";

export const metadata: Metadata = { title: "Recycle Bin" };

export default async function RecycleBinPage() {
  const ctx = await requireAuth();
  const { entries, retentionDays, restoredCount } = await listRecycleBin(ctx);

  return (
    <RecycleBinView
      entries={entries}
      retentionDays={retentionDays}
      restoredCount={restoredCount}
      canRestore={ctx.permissions.includes(PERMISSIONS.DATA_DELETE)}
    />
  );
}
