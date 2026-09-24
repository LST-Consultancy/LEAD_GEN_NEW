import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getSupportDiagnostics } from "@/lib/services/support";
import { SupportView } from "@/components/admin/support-view";
import { listSupportRequests } from "@/lib/services/support-requests";
import { PERMISSIONS } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Support" };

export default async function SupportPage() {
  const ctx = await requireAuth();
  const [{ checks, workspaceSlug }, requests] = await Promise.all([getSupportDiagnostics(ctx), listSupportRequests(ctx)]);
  return <SupportView checks={checks} workspaceSlug={workspaceSlug} requests={requests} isAdmin={ctx.permissions.includes(PERMISSIONS.USERS_MANAGE)} />;
}
