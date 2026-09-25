import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth/context";
import { listClaimable } from "@/lib/services/lead-claims";
import { ClaimQueue } from "@/components/leads/claim-queue";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  getFilterFacets,
  getShortcutCounts,
  listLeads,
  SHORTCUTS,
} from "@/lib/services/leads";
import { parseLeadParams } from "@/lib/leads/params";
import { LeadsView } from "@/components/leads/leads-view";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuth();
  const { filter, shortcut } = parseLeadParams(await searchParams);

  const [result, shortcutCounts, facets, claimable] = await Promise.all([
    listLeads(ctx, filter),
    getShortcutCounts(ctx),
    getFilterFacets(ctx),
    // Reps who see only their own leads get the claim queue; managers already see unowned leads in the list.
    ctx.permissions.includes(PERMISSIONS.LEADS_EDIT) && !ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL) ? listClaimable(ctx) : null,
  ]);

  const viewCookie = (await cookies()).get("sr_leads_view")?.value;
  const initialView =
    viewCookie === "cards" || viewCookie === "compact" ? viewCookie : "table";

  return (
    <>
    {claimable ? <div className="px-3 pt-3 sm:px-4"><ClaimQueue initial={claimable} /></div> : null}
    <LeadsView
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageCount={result.pageCount}
      pageSize={result.pageSize}
      filter={filter}
      shortcut={shortcut}
      shortcuts={SHORTCUTS.map((s) => ({ key: s.key, label: s.label, hint: s.hint }))}
      shortcutCounts={shortcutCounts}
      facets={facets}
      initialView={initialView}
      permissions={{
        reveal: ctx.permissions.includes(PERMISSIONS.LEADS_REVEAL),
        reassign: ctx.permissions.includes(PERMISSIONS.LEADS_VIEW_ALL),
        export: ctx.permissions.includes(PERMISSIONS.LEADS_EXPORT),
        edit: ctx.permissions.includes(PERMISSIONS.LEADS_EDIT),
      }}
    />
    </>
  );
}
