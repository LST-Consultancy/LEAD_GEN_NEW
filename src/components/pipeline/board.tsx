"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { DealCard, type Deal } from "@/components/pipeline/deal-card";
import { Metric } from "@/components/charts/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatInrCompact, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Column = {
  id: string;
  key: string;
  name: string;
  sortOrder: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
  stallAfterDays: number;
  count: number;
  totalInr: number;
  weightedInr: number;
  averageAgeDays: number;
  deals: Deal[];
};

type Totals = {
  openCount: number;
  openInr: number;
  weightedInr: number;
  atRiskInr: number;
  atRiskCount: number;
  watchInr: number;
  watchCount: number;
};

export function PipelineBoard({
  columns: initialColumns,
  totals,
  pipelineName,
}: {
  columns: Column[];
  totals: Totals;
  pipelineName: string;
}) {
  const router = useRouter();
  const [columns, setColumns] = React.useState(initialColumns);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [lostPrompt, setLostPrompt] = React.useState<{ dealId: string; toStageId: string } | null>(
    null
  );
  const [lostReason, setLostReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Server data wins whenever it arrives, so a refresh reconciles any drift.
  React.useEffect(() => setColumns(initialColumns), [initialColumns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  const allDeals = React.useMemo(() => columns.flatMap((c) => c.deals), [columns]);
  const activeDeal = allDeals.find((d) => d.id === activeId) ?? null;

  function recompute(cols: Column[]): Column[] {
    return cols.map((c) => {
      const totalInr = c.deals.reduce((s, d) => s + d.valueInr, 0);
      const ages = c.deals.map((d) => d.ageInStageDays);
      return {
        ...c,
        count: c.deals.length,
        totalInr,
        weightedInr: Math.round(totalInr * (c.probability / 100)),
        averageAgeDays: ages.length
          ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length)
          : 0,
      };
    });
  }

  function moveLocally(dealId: string, toStageId: string): Column[] | null {
    const fromCol = columns.find((c) => c.deals.some((d) => d.id === dealId));
    if (!fromCol || fromCol.id === toStageId) return null;
    const deal = fromCol.deals.find((d) => d.id === dealId)!;
    const toCol = columns.find((c) => c.id === toStageId);
    if (!toCol) return null;

    return recompute(
      columns.map((c) => {
        if (c.id === fromCol.id) return { ...c, deals: c.deals.filter((d) => d.id !== dealId) };
        if (c.id === toStageId) {
          return {
            ...c,
            deals: [
              {
                ...deal,
                stageId: toStageId,
                ageInStageDays: 0,
                isStalled: false,
                status: c.isWon ? "WON" : c.isLost ? "LOST" : "OPEN",
                // Entering a stage resolves the stage-stall flag; other risks persist.
                risks: deal.risks.filter((r) => r.code !== "stage_stalled"),
              },
              ...c.deals,
            ],
          };
        }
        return c;
      })
    );
  }

  /**
   * §34 — optimistic move with rollback. The board updates immediately, the
   * server is told, and a failure restores the previous state and says so.
   */
  async function commitMove(dealId: string, toStageId: string, reason?: string) {
    const snapshot = columns;
    const optimistic = moveLocally(dealId, toStageId);
    if (!optimistic) return;
    setColumns(optimistic);

    try {
      const res = await fetch(`/api/deals/${dealId}/stage`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toStageId, lostReason: reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "The move could not be saved.");
      }
      const target = columns.find((c) => c.id === toStageId);
      toast.success(`Moved to ${target?.name ?? "new stage"}`);
      router.refresh();
    } catch (err) {
      setColumns(snapshot);
      toast.error("Couldn't move that deal", {
        description:
          (err as Error).message +
          " The board has been put back the way it was — nothing was changed.",
      });
    }
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const dealId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;

    // Dropping on a card resolves to that card's column.
    const toStageId = columns.some((c) => c.id === overId)
      ? overId
      : (columns.find((c) => c.deals.some((d) => d.id === overId))?.id ?? null);
    if (!toStageId) return;

    const fromCol = columns.find((c) => c.deals.some((d) => d.id === dealId));
    if (!fromCol || fromCol.id === toStageId) return;

    const target = columns.find((c) => c.id === toStageId);
    // A loss must be learnable, so the reason is required before the move lands.
    if (target?.isLost) {
      setLostReason("");
      setLostPrompt({ dealId, toStageId });
      return;
    }
    void commitMove(dealId, toStageId);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header metrics */}
      <div className="shrink-0 border-b border-border bg-surface px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold tracking-tight text-primary">{pipelineName}</h1>
          <Badge variant="neutral">{formatNumber(totals.openCount)} open</Badge>
          <div className="ml-auto grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label="Open"
              value={formatInrCompact(totals.openInr)}
              size="sm"
              tone="brand"
              className="border-0 bg-transparent px-2 py-0 shadow-none"
              hint="Total unweighted value of every open deal on this board."
            />
            <Metric
              label="Weighted"
              value={formatInrCompact(totals.weightedInr)}
              size="sm"
              className="border-0 bg-transparent px-2 py-0 shadow-none"
              hint="Each deal multiplied by its stage probability."
            />
            <Metric
              label="At risk"
              value={formatInrCompact(totals.atRiskInr)}
              size="sm"
              tone={totals.atRiskInr > 0 ? "serious" : "good"}
              className="border-0 bg-transparent px-2 py-0 shadow-none"
              hint={`${totals.atRiskCount} open deals carry a high-severity flag: badly overrun on stage time, or silent for over five weeks.`}
            />
            <Metric
              label="On watch"
              value={formatInrCompact(totals.watchInr)}
              size="sm"
              tone={totals.watchCount > 0 ? "warning" : "good"}
              className="border-0 bg-transparent px-2 py-0 shadow-none"
              hint={`${totals.watchCount} open deals carry a medium flag — usually a missing next step. Worth tidying, not alarming.`}
            />
          </div>
        </div>
      </div>

      {/* Board */}
      <DndContext
        // A stable id keeps dnd-kit's generated aria-describedby ids identical
        // between the server and client renders, which otherwise mismatch.
        id="pipeline-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        modifiers={[restrictToWindowEdges]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up deal ${active.id}`,
            onDragOver: ({ over }) => (over ? `Over ${over.id}` : "No drop target"),
            onDragEnd: ({ over }) => (over ? `Dropped on ${over.id}` : "Move cancelled"),
            onDragCancel: () => "Move cancelled",
          },
        }}
      >
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full min-w-max gap-2.5 p-3">
            {columns.map((col) => (
              <StageColumn key={col.id} column={col} />
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22,1,0.36,1)" }}>
          {activeDeal ? (
            <div className="w-[268px]">
              <DealCard deal={activeDeal} overlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Lost reason — required so the loss is learnable (§73) */}
      <Dialog open={lostPrompt !== null} onOpenChange={(o) => !o && setLostPrompt(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Why was this lost?</DialogTitle>
            <DialogDescription>
              A loss without a reason teaches nothing. This is stored against the deal and feeds
              win/loss analysis.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <Label htmlFor="lost-reason" required>
              Reason
            </Label>
            <Textarea
              id="lost-reason"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              rows={3}
              placeholder="Chose a larger integrator on perceived delivery risk"
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                "Price",
                "Chose a competitor",
                "Budget deferred",
                "Went in-house",
                "No decision",
                "Lost champion",
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setLostReason(preset)}
                  className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-2xs text-secondary transition-colors hover:border-border-strong hover:text-primary"
                >
                  {preset}
                </button>
              ))}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setLostPrompt(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={saving}
              disabled={lostReason.trim().length < 3}
              onClick={async () => {
                if (!lostPrompt) return;
                setSaving(true);
                await commitMove(lostPrompt.dealId, lostPrompt.toStageId, lostReason.trim());
                setSaving(false);
                setLostPrompt(null);
              }}
            >
              Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StageColumn({ column }: { column: Column }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const stalled = column.deals.filter((d) => d.isStalled).length;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.name}, ${column.count} deals`}
      className={cn(
        "flex h-full w-[284px] shrink-0 flex-col rounded-lg border bg-surface-sunken transition-colors",
        isOver ? "border-brand bg-brand-subtle/40" : "border-border"
      )}
    >
      {/* Column header */}
      <div className="shrink-0 border-b border-border px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <h2 className="truncate text-xs font-semibold text-primary">{column.name}</h2>
          <span className="rounded bg-surface px-1 text-2xs font-semibold text-secondary tabular">
            {column.count}
          </span>
          {column.isWon ? (
            <Badge size="sm" variant="success" uppercase>
              Won
            </Badge>
          ) : column.isLost ? (
            <Badge size="sm" variant="danger" uppercase>
              Lost
            </Badge>
          ) : (
            <Tooltip content={`Deals at this stage historically close ${column.probability}% of the time.`}>
              <span className="ml-auto cursor-help text-2xs text-muted tabular">
                {column.probability}%
              </span>
            </Tooltip>
          )}
        </div>

        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-xs font-semibold text-primary tabular">
            {column.totalInr > 0 ? formatInrCompact(column.totalInr) : "—"}
          </span>
          {!column.isWon && !column.isLost && column.weightedInr > 0 ? (
            <Tooltip content="Stage value weighted by this stage's close probability.">
              <span className="cursor-help text-2xs text-muted tabular">
                {formatInrCompact(column.weightedInr)} weighted
              </span>
            </Tooltip>
          ) : null}
        </div>

        <div className="mt-0.5 flex items-center gap-2 text-2xs text-muted">
          {column.count > 0 ? <span>avg {column.averageAgeDays}d in stage</span> : null}
          {stalled > 0 ? (
            <Tooltip
              content={`${stalled} of ${column.count} deals here are past this stage's ${column.stallAfterDays}-day normal dwell time.`}
            >
              <span className="inline-flex cursor-help items-center gap-0.5 font-medium text-warning-text">
                <AlertTriangle className="size-2.5" />
                {stalled} stalled
              </span>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {/* Cards */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {column.deals.length === 0 ? (
          <div
            className={cn(
              "flex h-24 items-center justify-center rounded-md border border-dashed text-2xs text-muted transition-colors",
              isOver ? "border-brand bg-brand-subtle text-brand-text" : "border-border-strong"
            )}
          >
            {isOver ? "Drop here" : "Nothing at this stage"}
          </div>
        ) : (
          column.deals.map((deal) => <DraggableDeal key={deal.id} deal={deal} />)
        )}
      </div>
    </section>
  );
}

function DraggableDeal({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id });

  return (
    <DealCard
      deal={deal}
      dragging={isDragging}
      setNodeRef={setNodeRef}
      attributes={attributes as unknown as Record<string, unknown>}
      listeners={listeners as unknown as Record<string, unknown>}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 }
          : undefined
      }
    />
  );
}

/** §35 — pipeline AI: what needs attention, with the reason for each. */
export function PipelineInsights({ columns }: { columns: Column[] }) {
  const allDeals = columns.flatMap((c) => c.deals);
  const open = allDeals.filter((d) => d.status === "OPEN");
  const stalled = open.filter((d) => d.isStalled);
  const noNext = open.filter((d) => !d.nextActionLabel);
  const inactive = open.filter((d) => (d.inactiveDays ?? 0) > 14);
  const highValueAtRisk = open
    .filter((d) => d.risks.some((r) => r.severity === "high"))
    .sort((a, b) => b.valueInr - a.valueInr)
    .slice(0, 3);

  const findings: { title: string; body: string; tone: "warning" | "serious" | "info" }[] = [];

  if (stalled.length > 0) {
    findings.push({
      title: `${stalled.length} ${stalled.length === 1 ? "deal is" : "deals are"} stalled`,
      body: `Worth ${formatInrCompact(stalled.reduce((s, d) => s + d.valueInr, 0))}. Each has been in its current stage longer than that stage's normal dwell time, which historically correlates with a lower close rate. Agree a dated next step or move them to Lost.`,
      tone: "warning",
    });
  }
  if (noNext.length > 0) {
    findings.push({
      title: `${noNext.length} open ${noNext.length === 1 ? "deal has" : "deals have"} no next action`,
      body: `Worth ${formatInrCompact(noNext.reduce((s, d) => s + d.valueInr, 0))}. Nothing is scheduled to move them forward.`,
      tone: "warning",
    });
  }
  if (inactive.length > 0) {
    findings.push({
      title: `${inactive.length} ${inactive.length === 1 ? "deal has" : "deals have"} been silent for over two weeks`,
      body: "No message sent or received. Re-open with new information rather than a bare follow-up.",
      tone: "serious",
    });
  }
  if (highValueAtRisk.length > 0) {
    findings.push({
      title: "Highest-value deals carrying a high-severity flag",
      body: highValueAtRisk
        .map((d) => `${d.company.name} (${formatInrCompact(d.valueInr)}): ${d.risks.find((r) => r.severity === "high")?.title}`)
        .join(" · "),
      tone: "serious",
    });
  }

  return (
    <div className="border-t border-border bg-surface px-3 py-2.5 sm:px-4">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-ai-accent" />
        <h2 className="text-xs font-semibold text-primary">What needs attention</h2>
        <span className="text-2xs text-muted">
          derived from stage dwell times and recorded activity
        </span>
      </div>

      {findings.length === 0 ? (
        <p className="mt-1.5 text-2xs text-success-text">
          Nothing flagged. Every open deal has recent activity and a scheduled next step.
        </p>
      ) : (
        <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
          {findings.map((f) => (
            <li
              key={f.title}
              className={cn(
                "rounded-md border px-2.5 py-2",
                f.tone === "serious"
                  ? "border-danger-border bg-danger-subtle"
                  : f.tone === "warning"
                    ? "border-warning-border bg-warning-subtle"
                    : "border-border bg-surface-sunken"
              )}
            >
              <p
                className={cn(
                  "text-2xs font-semibold",
                  f.tone === "serious"
                    ? "text-danger-text"
                    : f.tone === "warning"
                      ? "text-warning-text"
                      : "text-primary"
                )}
              >
                {f.title}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-2xs leading-relaxed",
                  f.tone === "serious"
                    ? "text-danger-text/90"
                    : f.tone === "warning"
                      ? "text-warning-text/90"
                      : "text-secondary"
                )}
              >
                {f.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 flex items-start gap-1.5 text-2xs leading-relaxed text-muted">
        <Info className="mt-0.5 size-3 shrink-0" />
        These are pattern flags from your own stage history, not predictions about these specific
        deals. Weighted value is a statistical figure — it is not a forecast of what will close.
      </p>
    </div>
  );
}

export function EmptyPipeline() {
  return (
    <div className="p-6">
      <EmptyState
        title="No deals yet"
        description="Deals appear here once you create one from a lead. A lead without a deal costs nothing to keep, so only promote the ones with a real opportunity behind them."
      />
    </div>
  );
}
