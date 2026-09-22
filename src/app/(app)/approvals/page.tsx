import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { listApprovals, summariseApprovals } from "@/lib/services/trust";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApprovalsView } from "@/components/autopilot/approvals-view";

export const metadata: Metadata = { title: "Approval Center" };

export default async function ApprovalsPage() {
  const ctx = await requireAuth();
  const pending = await listApprovals(ctx);

  return (
    <ApprovalsView
      pending={pending}
      summary={summariseApprovals(pending)}
      canApprove={ctx.permissions.includes(PERMISSIONS.OUTREACH_APPROVE)}
    />
  );
}
