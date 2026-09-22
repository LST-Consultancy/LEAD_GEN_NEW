import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listArchivedLeads } from "@/lib/services/archived";
import { ArchivedView } from "@/components/admin/archived-view";

export const metadata: Metadata = { title: "Archived Leads" };

export default async function ArchivedPage() {
  const ctx = await requireAuth();
  const { leads, total, autoArchiveAfterDays } = await listArchivedLeads(ctx);

  return (
    <ArchivedView
      leads={leads}
      total={total}
      autoArchiveAfterDays={autoArchiveAfterDays}
      canEdit={ctx.permissions.includes(PERMISSIONS.LEADS_EDIT)}
    />
  );
}
