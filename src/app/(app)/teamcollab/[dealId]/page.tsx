import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDealPlan } from "@/lib/services/deal-plans";
import { PlanView } from "@/components/plans/plan-view";

export const metadata: Metadata = { title: "Deal plan" };

export default async function DealPlanPage({ params }: { params: Promise<{ dealId: string }> }) {
  const ctx = await requireAuth();
  const { dealId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) notFound();
  const data = await getDealPlan(ctx, dealId);
  if (!data) notFound();
  return <PlanView data={data} canEdit={ctx.permissions.includes(PERMISSIONS.PIPELINE_EDIT)} />;
}
