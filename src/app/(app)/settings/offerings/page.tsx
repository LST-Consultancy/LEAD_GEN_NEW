import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listOfferings } from "@/lib/services/offerings";
import { OfferingsEditor } from "@/components/opportunities/offerings-editor";

export const metadata: Metadata = { title: "Offerings" };

export default async function OfferingsPage() {
  const ctx = await requireAuth();
  const offerings = await listOfferings(ctx);
  return <OfferingsEditor initial={offerings} canManage={ctx.permissions.includes(PERMISSIONS.ICP_MANAGE)} />;
}
