import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getSupportDiagnostics } from "@/lib/services/support";
import { SupportView } from "@/components/admin/support-view";

export const metadata: Metadata = { title: "Support" };

export default async function SupportPage() {
  const ctx = await requireAuth();
  const { checks, workspaceSlug } = await getSupportDiagnostics(ctx);
  return <SupportView checks={checks} workspaceSlug={workspaceSlug} />;
}
