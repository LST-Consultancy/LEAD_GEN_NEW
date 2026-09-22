import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth/context";
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

  const [result, shortcutCounts, facets] = await Promise.all([
    listLeads(ctx, filter),
    getShortcutCounts(ctx),
    getFilterFacets(ctx),
  ]);

  const viewCookie = (await cookies()).get("sr_leads_view")?.value;
  const initialView =
    viewCookie === "cards" || viewCookie === "compact" ? viewCookie : "table";

  return (
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
    />
  );
}
