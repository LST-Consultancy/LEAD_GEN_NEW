"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  LayoutGrid,
  Rows3,
  Search,
  Sparkles,
  Table2,
  Target,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { SkeletonRows } from "@/components/ui/skeleton";
import { SmartShortcuts } from "@/components/leads/shortcuts";
import { LeadsTable, LeadsCards, type LeadRow } from "@/components/leads/leads-table";
import { FilterPanel, type Facets } from "@/components/leads/filter-panel";
import { AddLeadButton } from "@/components/leads/add-lead-dialog";
import { BulkActions, SaveSearchButton, SaveSmartListButton, downloadCsv, type BulkPermissions } from "@/components/leads/bulk-actions";
import { buildLeadQuery, countActiveFilters } from "@/lib/leads/params";
import { filterProblems, type LeadFilter } from "@/lib/leads/filter";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type View = "table" | "cards" | "compact";

export function LeadsView({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  filter,
  shortcut,
  shortcuts,
  shortcutCounts,
  facets,
  initialView,
  permissions,
}: {
  rows: LeadRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  filter: LeadFilter;
  shortcut: string | null;
  shortcuts: { key: string; label: string; hint: string }[];
  shortcutCounts: Record<string, number>;
  facets: Facets;
  initialView: View;
  permissions: BulkPermissions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();

  const [view, setView] = React.useState<View>(initialView);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [query, setQuery] = React.useState(filter.q ?? "");

  const activeCount = countActiveFilters(filter);

  // URL is the source of truth; navigation drives a server re-render.
  const navigate = React.useCallback(
    (next: Partial<LeadFilter> & { shortcut?: string | null }) => {
      startTransition(() => {
        router.push(`${pathname}${buildLeadQuery(next)}`, { scroll: false });
      });
    },
    [router, pathname]
  );

  // Debounced search so typing doesn't fire a request per keystroke.
  React.useEffect(() => {
    if (query === (filter.q ?? "")) return;
    const timer = setTimeout(() => {
      navigate({ ...filter, shortcut, q: query || undefined, page: 1 });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  React.useEffect(() => {
    setSelected(new Set());
  }, [rows]);

  function setViewAndPersist(next: View) {
    setView(next);
    document.cookie = `sr_leads_view=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="shrink-0 space-y-2.5 border-b border-border bg-surface px-3 pb-2.5 pt-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, company, title, signal…"
              className="pl-8 pr-7"
              aria-label="Search leads"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-primary"
                aria-label="Clear search"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>

          <Button
            variant={activeCount > 0 ? "ai" : "secondary"}
            size="md"
            onClick={() => setFilterOpen(true)}
          >
            <Filter />
            Filters
            {activeCount > 0 ? (
              <Badge variant="solid" size="sm" className="ml-0.5">
                {activeCount}
              </Badge>
            ) : null}
          </Button>
          {activeCount > 0 ? <><SaveSearchButton filter={{ ...filter }} /><SaveSmartListButton filter={{ ...filter }} /></> : null}
          {permissions.export ? (
            <Tooltip content={`Download all ${total} leads matching the current filters as CSV. Locked contacts stay locked.`}>
              <Button
                variant="ghost"
                size="md"
                disabled={total === 0}
                onClick={async () => {
                  try {
                    await downloadCsv({ filter: { ...filter } });
                    toast.success("Export downloaded", { description: `${total} leads. Recorded in the audit log.` });
                  } catch (err) {
                    toast.error("Couldn't export", { description: err instanceof Error ? err.message : "Nothing was downloaded." });
                  }
                }}
              >
                <Download />
                Export all
              </Button>
            </Tooltip>
          ) : null}
          {permissions.edit ? <AddLeadButton /> : null}

          {activeCount > 0 ? (
            <Button
              variant="ghost"
              size="md"
              onClick={() => navigate({ combine: "AND", shortcut: null })}
            >
              <X />
              Clear
            </Button>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-2xs text-muted tabular sm:inline">
              {total === 0 ? "No leads" : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}
            </span>

            <div
              className="flex items-center gap-0.5 rounded-md border border-border bg-surface-sunken p-0.5"
              role="group"
              aria-label="View mode"
            >
              {(
                [
                  ["table", Table2, "Table"],
                  ["compact", Rows3, "Compact"],
                  ["cards", LayoutGrid, "Cards"],
                ] as const
              ).map(([key, Icon, label]) => (
                <Tooltip key={key} content={label}>
                  <button
                    type="button"
                    onClick={() => setViewAndPersist(key)}
                    aria-pressed={view === key}
                    aria-label={label}
                    className={cn(
                      "rounded p-1 transition-colors",
                      view === key
                        ? "bg-surface text-primary shadow-card"
                        : "text-muted hover:text-secondary"
                    )}
                  >
                    <Icon className="size-3.5" />
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        </div>

        <SmartShortcuts
          shortcuts={shortcuts}
          counts={shortcutCounts}
          active={shortcut}
          pending={pending}
          onSelect={(key) =>
            navigate(key ? { shortcut: key, page: 1, combine: "AND" } : { combine: "AND", page: 1 })
          }
        />
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-brand-border bg-brand-subtle px-3 py-2 sm:px-4 animate-in-up">
          <span className="text-xs font-semibold text-brand-text tabular">
            {selected.size} selected
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <BulkActions ids={[...selected]} permissions={permissions} listId={filter.listId && !facets.lists.find((l) => l.id === filter.listId)?.isDynamic ? filter.listId : undefined} onDone={() => setSelected(new Set())} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            Deselect
          </Button>
        </div>
      ) : null}

      {filterProblems(filter).length ? (
        <div role="alert" className="shrink-0 border-b border-warning-border bg-warning-subtle px-4 py-1.5 text-2xs text-warning-text">
          {filterProblems(filter).join(" ")} That is why nothing matches — open Filters to fix it.
        </div>
      ) : null}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {pending && rows.length === 0 ? (
          <SkeletonRows rows={12} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyStateForFilter
            hasFilters={activeCount > 0}
            onClear={() => navigate({ combine: "AND", shortcut: null })}
          />
        ) : view === "cards" ? (
          <LeadsCards
            rows={rows}
            selected={selected}
            onSelectedChange={setSelected}
            pending={pending}
          />
        ) : (
          <LeadsTable
            rows={rows}
            selected={selected}
            onSelectedChange={setSelected}
            sort={filter.sort}
            dir={filter.dir}
            density={view === "compact" ? "compact" : "normal"}
            pending={pending}
            onSort={(key) =>
              navigate({
                ...filter,
                shortcut,
                sort: key,
                dir: filter.sort === key && filter.dir === "desc" ? "asc" : "desc",
                page: 1,
              })
            }
          />
        )}
      </div>

      {/* Pagination */}
      {pageCount > 1 ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-3 py-2 sm:px-4">
          <span className="text-2xs text-muted tabular">
            Page {page} of {pageCount}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || pending}
              onClick={() => navigate({ ...filter, shortcut, page: page - 1 })}
            >
              <ChevronLeft />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= pageCount || pending}
              onClick={() => navigate({ ...filter, shortcut, page: page + 1 })}
            >
              Next
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        facets={facets}
        value={filter}
        onApply={(next) => navigate({ ...next, shortcut: null, page: 1 })}
      />
    </div>
  );
}

function EmptyStateForFilter({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean;
  onClear: () => void;
}) {
  if (hasFilters) {
    return (
      <div className="p-6">
        <Card>
          <EmptyState
            icon={Filter}
            title="No leads match these filters"
            description="Nothing in your workspace satisfies every condition. Try removing the narrowest one, or switch the groups to match any instead of all."
            action={
              <Button size="sm" variant="primary" onClick={onClear}>
                Clear filters
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  // §97 — the first-run empty state teaches rather than just reporting nothing.
  return (
    <div className="p-6">
      <Card>
        <EmptyState
          icon={Target}
          title="No leads yet"
          description="Tell us who you sell to and we'll begin watching for buying signals — public posts, job openings, tenders and technology changes that indicate someone is looking for what you offer."
          action={
            <Button size="sm" variant="primary" asChild>
              <Link href="/find-leads">
                <Sparkles />
                Find my first leads
              </Link>
            </Button>
          }
          secondaryAction={
            <Button size="sm" variant="ghost" asChild>
              <Link href="/settings/icp">Define my ICP first</Link>
            </Button>
          }
        />
      </Card>
    </div>
  );
}
