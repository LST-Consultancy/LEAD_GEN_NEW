"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  ArrowRight,
  Building2,
  CornerDownLeft,
  FileText,
  GitBranch,
  Loader2,
  Search,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { NAV } from "@/lib/nav";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Kbd } from "@/components/ui/kbd";
import { Badge } from "@/components/ui/badge";
import { ScorePill, TierBadge } from "@/components/domain/indicators";
import { cn } from "@/lib/utils";
import { formatInrCompact } from "@/lib/format";
import type { TierKey } from "@/lib/vocab";

type SearchResult = {
  leads: { id: string; name: string; title: string; company: string; tier: string; score: number }[];
  companies: { id: string; name: string; industry: string | null; city: string | null; leadCount: number }[];
  deals: { id: string; title: string; company: string; valueInr: number; stage: string }[];
  proposals: { id: string; title: string; company: string; state: string }[];
};

const EMPTY: SearchResult = { leads: [], companies: [], deals: [], proposals: [] };

/**
 * §4 / §116 / §117 — one surface for navigation, entity search and slash
 * commands. Slash input switches to command mode; plain text searches entities.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onOpenCopilot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCopilot: (seed?: string) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult>(EMPTY);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const trimmed = query.trim();
  const isCommand = trimmed.startsWith("/");

  // Debounced universal search. Aborts in-flight requests on each keystroke.
  React.useEffect(() => {
    if (!open || isCommand || trimmed.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("search failed");
        setResults((await res.json()) as SearchResult);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, trimmed, isCommand]);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  const commandActions = React.useMemo(
    () => [
      { id: "brief", label: "Read my brief", hint: "/brief", icon: Sparkles, run: () => go("/today") },
      { id: "pipeline", label: "Open pipeline", hint: "/pipeline", icon: GitBranch, run: () => go("/pipeline") },
      { id: "leads", label: "Open leads", hint: "/leads", icon: Target, run: () => go("/leads") },
      {
        id: "hot",
        label: "Show hot leads",
        hint: "/hot",
        icon: Target,
        run: () => go("/leads?shortcut=hot-intent"),
      },
      {
        id: "needs-you",
        label: "Show what needs me",
        hint: "/needs-you",
        icon: Users,
        run: () => go("/my-queue?tab=needs-you"),
      },
      {
        id: "copilot",
        label: "Ask Copilot",
        hint: "/ask",
        icon: Sparkles,
        run: () => {
          onOpenChange(false);
          onOpenCopilot(trimmed.replace(/^\/\w+\s*/, ""));
        },
      },
      { id: "proposal", label: "Create a proposal", hint: "/proposal", icon: FileText, run: () => go("/proposals") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trimmed]
  );

  const hasResults =
    results.leads.length + results.companies.length + results.deals.length + results.proposals.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-overlay data-[state=open]:animate-in-up"
          aria-label="Command palette"
        >
          <VisuallyHidden>
            <DialogPrimitive.Title>Command palette</DialogPrimitive.Title>
            <DialogPrimitive.Description>
              Search leads, companies and deals, or type a slash command.
            </DialogPrimitive.Description>
          </VisuallyHidden>

          <Command shouldFilter={!hasResults || isCommand} loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border-subtle px-3.5">
              {loading ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted" />
              ) : (
                <Search className="size-4 shrink-0 text-muted" />
              )}
              <Command.Input
                value={query}
                onValueChange={setQuery}
                autoFocus
                placeholder="Search leads, companies, deals — or type / for commands"
                className="h-12 flex-1 bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
              />
              <Kbd className="shrink-0">Esc</Kbd>
            </div>

            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-xs text-muted">
                {failed
                  ? "Search is unavailable right now. Navigation below still works."
                  : trimmed.length === 0
                    ? "Start typing to search."
                    : `Nothing matched “${trimmed}”.`}
              </Command.Empty>

              {isCommand ? (
                <Group heading="Commands">
                  {commandActions.map((action) => (
                    <Item
                      key={action.id}
                      value={`${action.hint} ${action.label}`}
                      onSelect={action.run}
                      icon={<action.icon className="size-3.5" />}
                      label={action.label}
                      trailing={<span className="font-mono text-2xs text-muted">{action.hint}</span>}
                    />
                  ))}
                </Group>
              ) : null}

              {!isCommand && results.leads.length > 0 ? (
                <Group heading="Leads">
                  {results.leads.map((lead) => (
                    <Item
                      key={lead.id}
                      value={`lead-${lead.id}`}
                      onSelect={() => go(`/leads/${lead.id}`)}
                      icon={<TierBadge tier={lead.tier as TierKey} size="sm" withTooltip={false} />}
                      label={lead.name}
                      sub={`${lead.title} · ${lead.company}`}
                      trailing={<ScorePill score={lead.score} />}
                    />
                  ))}
                </Group>
              ) : null}

              {!isCommand && results.companies.length > 0 ? (
                <Group heading="Companies">
                  {results.companies.map((c) => (
                    <Item
                      key={c.id}
                      value={`company-${c.id}`}
                      onSelect={() => go(`/accounts/${c.id}`)}
                      icon={<Building2 className="size-3.5" />}
                      label={c.name}
                      sub={[c.industry, c.city].filter(Boolean).join(" · ") || undefined}
                      trailing={
                        <span className="text-2xs text-muted tabular">
                          {c.leadCount} {c.leadCount === 1 ? "lead" : "leads"}
                        </span>
                      }
                    />
                  ))}
                </Group>
              ) : null}

              {!isCommand && results.deals.length > 0 ? (
                <Group heading="Deals">
                  {results.deals.map((d) => (
                    <Item
                      key={d.id}
                      value={`deal-${d.id}`}
                      onSelect={() => go(`/pipeline?deal=${d.id}`)}
                      icon={<GitBranch className="size-3.5" />}
                      label={d.title}
                      sub={`${d.company} · ${d.stage}`}
                      trailing={
                        <span className="text-2xs font-semibold text-secondary tabular">
                          {formatInrCompact(d.valueInr)}
                        </span>
                      }
                    />
                  ))}
                </Group>
              ) : null}

              {!isCommand && results.proposals.length > 0 ? (
                <Group heading="Proposals">
                  {results.proposals.map((p) => (
                    <Item
                      key={p.id}
                      value={`proposal-${p.id}`}
                      onSelect={() => go(`/proposals/${p.id}`)}
                      icon={<FileText className="size-3.5" />}
                      label={p.title}
                      sub={p.company}
                      trailing={<Badge size="sm">{p.state}</Badge>}
                    />
                  ))}
                </Group>
              ) : null}

              {!isCommand ? (
                <>
                  <Group heading="Ask">
                    <Item
                      value="ask-copilot"
                      onSelect={() => {
                        onOpenChange(false);
                        onOpenCopilot(trimmed || undefined);
                      }}
                      icon={<Sparkles className="size-3.5 text-ai-accent" />}
                      label={trimmed ? `Ask Copilot: “${trimmed}”` : "Ask Copilot"}
                      trailing={<CornerDownLeft className="size-3 text-muted" />}
                    />
                  </Group>

                  {NAV.map((group) => (
                    <Group key={group.key} heading={group.label}>
                      {group.items.map((item) => (
                        <Item
                          key={item.key}
                          value={`${item.label} ${item.keywords?.join(" ") ?? ""} ${item.purpose}`}
                          onSelect={() => go(item.href)}
                          icon={<item.icon className="size-3.5" />}
                          label={item.label}
                          sub={item.purpose}
                          trailing={
                            item.status === "planned" ? (
                              <span className="text-2xs text-muted">Soon</span>
                            ) : (
                              <ArrowRight className="size-3 text-muted" />
                            )
                          }
                        />
                      ))}
                    </Group>
                  ))}
                </>
              ) : null}
            </Command.List>

            <div className="flex items-center gap-3 border-t border-border-subtle bg-surface-sunken px-3.5 py-2 text-2xs text-muted">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> open
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Kbd>/</Kbd> commands
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  value,
  onSelect,
  icon,
  label,
  sub,
  trailing,
}: {
  value: string;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-xs outline-none",
        "data-[selected=true]:bg-surface-hover"
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-primary">{label}</span>
        {sub ? <span className="block truncate text-2xs text-muted">{sub}</span> : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </Command.Item>
  );
}
