"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerFooter,
} from "@/components/ui/drawer";
import { INTENT_ORDER, INTENT, LEAD_STATUS, TIER, SIGNAL_TYPE_LABEL } from "@/lib/vocab";
import type { LeadFilter } from "@/lib/leads/filter";
import { cn } from "@/lib/utils";

export type Facets = {
  industries: string[];
  cities: string[];
  states: string[];
  owners: { id: string; name: string }[];
  lists: { id: string; name: string; isDynamic: boolean; count: number }[];
  signalTypes: string[];
  technologies: string[];
  seniorities: string[];
  departments: string[];
};

type Draft = Partial<LeadFilter>;

/**
 * §19 — the filter builder. Multi-value groups combine with AND by default;
 * the AND/OR toggle switches how the groups themselves combine, which is stated
 * in plain language rather than left to be inferred.
 */
export function FilterPanel({
  open,
  onOpenChange,
  facets,
  value,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facets: Facets;
  value: Draft;
  onApply: (next: Draft) => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(value);

  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  function set<K extends keyof Draft>(key: K, v: Draft[K]) {
    setDraft((d) => {
      const next = { ...d };
      if (v === undefined || v === null || (Array.isArray(v) && v.length === 0) || v === false) {
        delete next[key];
      } else {
        next[key] = v;
      }
      return next;
    });
  }

  function toggleIn<K extends keyof Draft>(key: K, item: string) {
    const current = (draft[key] as string[] | undefined) ?? [];
    const next = current.includes(item)
      ? current.filter((x) => x !== item)
      : [...current, item];
    set(key, next as Draft[K]);
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="sm:max-w-[400px]">
        <DrawerHeader>
          <DrawerTitle>Filter leads</DrawerTitle>
          <p className="text-2xs text-muted">
            Values inside a group are OR-ed. Groups combine with{" "}
            <strong>{draft.combine === "OR" ? "OR" : "AND"}</strong>.
          </p>
        </DrawerHeader>

        <DrawerBody className="px-0 py-0">
          <ScrollArea className="h-full" viewportClassName="px-5 py-4">
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2">
                <div>
                  <Label htmlFor="combine">Match any group instead of all</Label>
                  <p className="mt-0.5 text-2xs text-muted">
                    {draft.combine === "OR"
                      ? "A lead matching any one group is included."
                      : "A lead must match every group."}
                  </p>
                </div>
                <Switch
                  id="combine"
                  checked={draft.combine === "OR"}
                  onCheckedChange={(c) => set("combine", c ? "OR" : "AND")}
                />
              </div>

              <Group label="ICP tier">
                <div className="flex gap-1.5">
                  {(["A", "B", "C", "D"] as const).map((t) => {
                    const on = (draft.tiers ?? []).includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleIn("tiers", t)}
                        aria-pressed={on}
                        className={cn(
                          "flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors",
                          on
                            ? "border-brand bg-brand-subtle text-brand-text"
                            : "border-border bg-surface text-secondary hover:border-border-strong"
                        )}
                        title={TIER[t].meaning}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </Group>

              <Group label="Score range" hint="Out of 10">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    placeholder="Min"
                    value={draft.minScore ?? ""}
                    onChange={(e) =>
                      set("minScore", e.target.value === "" ? undefined : Number(e.target.value))
                    }
                    aria-label="Minimum score"
                  />
                  <span className="text-xs text-muted">to</span>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    placeholder="Max"
                    value={draft.maxScore ?? ""}
                    onChange={(e) =>
                      set("maxScore", e.target.value === "" ? undefined : Number(e.target.value))
                    }
                    aria-label="Maximum score"
                  />
                </div>
              </Group>

              <Group label="Buyer intent">
                <CheckList
                  items={INTENT_ORDER.map((k) => ({ value: k, label: INTENT[k].label }))}
                  selected={draft.intents ?? []}
                  onToggle={(v) => toggleIn("intents", v)}
                />
              </Group>

              <Group label="Status">
                <CheckList
                  items={Object.entries(LEAD_STATUS).map(([k, v]) => ({ value: k, label: v.label }))}
                  selected={draft.statuses ?? []}
                  onToggle={(v) => toggleIn("statuses", v)}
                />
              </Group>

              <Separator />

              <Group label="Industry">
                <CheckList
                  items={facets.industries.map((i) => ({ value: i, label: i }))}
                  selected={draft.industries ?? []}
                  onToggle={(v) => toggleIn("industries", v)}
                  scroll
                />
              </Group>

              <Group label="City">
                <CheckList
                  items={facets.cities.map((c) => ({ value: c, label: c }))}
                  selected={draft.cities ?? []}
                  onToggle={(v) => toggleIn("cities", v)}
                  scroll
                />
              </Group>

              <Group label="State">
                <CheckList
                  items={facets.states.map((s) => ({ value: s, label: s }))}
                  selected={draft.states ?? []}
                  onToggle={(v) => toggleIn("states", v)}
                  scroll
                />
              </Group>

              <Group label="Company size" hint="Employees">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    placeholder="Min"
                    value={draft.employeeMin ?? ""}
                    onChange={(e) =>
                      set("employeeMin", e.target.value === "" ? undefined : Number(e.target.value))
                    }
                    aria-label="Minimum employees"
                  />
                  <span className="text-xs text-muted">to</span>
                  <Input
                    type="number"
                    min={0}
                    placeholder="Max"
                    value={draft.employeeMax ?? ""}
                    onChange={(e) =>
                      set("employeeMax", e.target.value === "" ? undefined : Number(e.target.value))
                    }
                    aria-label="Maximum employees"
                  />
                </div>
              </Group>

              <Group label="Technology">
                <CheckList
                  items={facets.technologies.map((t) => ({ value: t, label: t }))}
                  selected={draft.technologies ?? []}
                  onToggle={(v) => toggleIn("technologies", v)}
                  scroll
                />
              </Group>

              <Separator />

              <Group label="Seniority">
                <CheckList
                  items={facets.seniorities.map((s) => ({
                    value: s,
                    label: s.replace(/_/g, " "),
                  }))}
                  selected={draft.seniorities ?? []}
                  onToggle={(v) => toggleIn("seniorities", v)}
                  scroll
                />
              </Group>

              <Group label="Department">
                <CheckList
                  items={facets.departments.map((d) => ({ value: d, label: d }))}
                  selected={draft.departments ?? []}
                  onToggle={(v) => toggleIn("departments", v)}
                />
              </Group>

              <Group label="Signal type">
                <CheckList
                  items={facets.signalTypes.map((t) => ({
                    value: t,
                    label: SIGNAL_TYPE_LABEL[t] ?? t,
                  }))}
                  selected={draft.signalTypes ?? []}
                  onToggle={(v) => toggleIn("signalTypes", v)}
                  scroll
                />
              </Group>

              <Separator />

              <Group label="Estimated value" hint="Rupees">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={100000}
                    placeholder="Min"
                    value={draft.budgetMin ?? ""}
                    onChange={(e) =>
                      set("budgetMin", e.target.value === "" ? undefined : Number(e.target.value))
                    }
                    aria-label="Minimum estimated value"
                  />
                  <span className="text-xs text-muted">to</span>
                  <Input
                    type="number"
                    min={0}
                    step={100000}
                    placeholder="Max"
                    value={draft.budgetMax ?? ""}
                    onChange={(e) =>
                      set("budgetMax", e.target.value === "" ? undefined : Number(e.target.value))
                    }
                    aria-label="Maximum estimated value"
                  />
                </div>
              </Group>

              <Group label="Timing">
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label htmlFor="surfaced">Surfaced within (days)</Label>
                    <Input
                      id="surfaced"
                      type="number"
                      min={1}
                      placeholder="Any"
                      value={draft.surfacedWithinDays ?? ""}
                      onChange={(e) =>
                        set(
                          "surfacedWithinDays",
                          e.target.value === "" ? undefined : Number(e.target.value)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="notcontacted">Not contacted for (days)</Label>
                    <Input
                      id="notcontacted"
                      type="number"
                      min={1}
                      placeholder="Any"
                      value={draft.notContactedForDays ?? ""}
                      onChange={(e) =>
                        set(
                          "notContactedForDays",
                          e.target.value === "" ? undefined : Number(e.target.value)
                        )
                      }
                    />
                  </div>
                </div>
              </Group>

              <Group label="Owner">
                <CheckList
                  items={facets.owners.map((o) => ({ value: o.id, label: o.name }))}
                  selected={draft.ownerIds ?? []}
                  onToggle={(v) => toggleIn("ownerIds", v)}
                />
              </Group>

              <Group label="List membership">
                <CheckList
                  items={facets.lists.map((l) => ({
                    value: l.id,
                    label: `${l.name} (${l.isDynamic ? "smart" : l.count})`,
                  }))}
                  selected={draft.listId ? [draft.listId] : []}
                  onToggle={(v) => set("listId", draft.listId === v ? undefined : v)}
                />
              </Group>

              <Separator />

              <Group label="Flags">
                <div className="space-y-1.5">
                  {(
                    [
                      ["starred", "Starred only"],
                      ["decisionMakersOnly", "Decision makers only"],
                      ["replied", "Has replied"],
                      ["reachable", "Reachable (email or phone on file)"],
                      ["revealed", "Contact already revealed"],
                      ["hasBudget", "Has an estimated value"],
                      ["hasSignal", "Has at least one signal"],
                      ["noOutreach", "Never contacted"],
                      ["needsFollowUp", "Next action due or overdue"],
                      ["includeArchived", "Include archived leads"],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-secondary transition-colors hover:bg-surface-hover"
                    >
                      <Checkbox
                        checked={Boolean(draft[key])}
                        onCheckedChange={(c) => set(key, (c === true) as never)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Group>
            </div>
          </ScrollArea>
        </DrawerBody>

        <DrawerFooter className="flex flex-row gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => {
              setDraft({ combine: "AND" });
              onApply({ combine: "AND" });
              onOpenChange(false);
            }}
          >
            <X />
            Clear all
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            Apply filters
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-2xs font-semibold uppercase tracking-wider text-muted">
        {label}
        {hint ? <span className="ml-1 font-normal normal-case tracking-normal">· {hint}</span> : null}
      </legend>
      {children}
    </fieldset>
  );
}

function CheckList({
  items,
  selected,
  onToggle,
  scroll,
}: {
  items: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  scroll?: boolean;
}) {
  if (items.length === 0) {
    return <p className="text-2xs text-muted">Nothing to filter on yet.</p>;
  }
  return (
    <div
      className={cn(
        "space-y-0.5",
        scroll && items.length > 7 && "max-h-40 overflow-y-auto rounded-md border border-border-subtle p-1"
      )}
    >
      {items.map((item) => (
        <label
          key={item.value}
          className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs capitalize text-secondary transition-colors hover:bg-surface-hover"
        >
          <Checkbox
            checked={selected.includes(item.value)}
            onCheckedChange={() => onToggle(item.value)}
          />
          <span className="truncate">{item.label}</span>
        </label>
      ))}
    </div>
  );
}
