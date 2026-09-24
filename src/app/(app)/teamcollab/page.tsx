import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth } from "@/lib/auth/context";
import { listStickyNotes } from "@/lib/services/teamcollab";
import { dealsWithoutPlan, listDealPlans } from "@/lib/services/deal-plans";
import { TeamCollabView } from "@/components/admin/teamcollab-view";
import { PlansList } from "@/components/plans/plans-list";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "TeamCollab" };

/** Plans (the work) and the scratchpad (the notes), as two tabs. The tab lives in the URL. */
export default async function TeamCollabPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAuth();
  const tab = (await searchParams).tab === "scratchpad" ? "scratchpad" : "plans";
  const tabs = [["plans", "Plans"], ["scratchpad", "Scratchpad"]] as const;
  return (
    <div className="mx-auto max-w-5xl space-y-3 px-3 py-4 sm:px-4">
      <nav className="flex gap-1 border-b border-border" aria-label="TeamCollab sections">
        {tabs.map(([key, label]) => (
          <Link key={key} href={key === "plans" ? "/teamcollab" : "/teamcollab?tab=scratchpad"} aria-current={tab === key ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-1.5 text-xs", tab === key ? "border-brand font-medium text-primary" : "border-transparent text-secondary hover:text-primary")}>
            {label}
          </Link>
        ))}
      </nav>
      {tab === "plans"
        ? <PlansList plans={await listDealPlans(ctx)} candidates={await dealsWithoutPlan(ctx)} />
        : <TeamCollabView notes={await listStickyNotes(ctx)} />}
    </div>
  );
}
