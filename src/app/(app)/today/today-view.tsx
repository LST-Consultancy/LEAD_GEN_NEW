"use client";

import * as React from "react";
import { LayoutGrid, Radar } from "lucide-react";
import { CopilotBrief } from "@/components/today/brief";
import { LeadOfTheDay } from "@/components/today/lead-of-day";
import { RevenueInReach, RevenueInMotion } from "@/components/today/revenue";
import { Worklist, type WorklistItem } from "@/components/today/worklist";
import { SalesHealth } from "@/components/today/health";
import {
  AiSalesCoach,
  DemandIndexTeaser,
  MorningBriefing,
  StickyNotes,
  WhileYouSlept,
} from "@/components/today/sidecards";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Layout = "classic" | "mission";

/**
 * §5 — two layouts over one dataset. Classic is a calm overview; Mission
 * Control is a dense operating console. The choice persists in a cookie so the
 * server renders the right one on first paint.
 */
export function TodayView({
  greeting,
  firstName,
  data,
  initialLayout,
}: {
  greeting: string;
  firstName: string;
  data: {
    brief: React.ComponentProps<typeof CopilotBrief>["brief"];
    leadOfDay: React.ComponentProps<typeof LeadOfTheDay>["lead"];
    revenue: React.ComponentProps<typeof RevenueInReach>["revenue"];
    worklist: WorklistItem[];
    health: React.ComponentProps<typeof SalesHealth>["health"];
    motion: React.ComponentProps<typeof RevenueInMotion>["motion"];
    heatmap: React.ComponentProps<typeof ActivityHeatmap>;
    coach: React.ComponentProps<typeof AiSalesCoach>["coach"];
    digest: React.ComponentProps<typeof WhileYouSlept>["digest"];
    notes: React.ComponentProps<typeof StickyNotes>["notes"];
  };
  initialLayout: Layout;
}) {
  const [layout, setLayout] = React.useState<Layout>(initialLayout);
  const [motion, setMotion] = React.useState(data.motion);
  const [motionPending, setMotionPending] = React.useState(false);

  function switchLayout(next: Layout) {
    setLayout(next);
    document.cookie = `sr_today_layout=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  async function changePeriod(days: number) {
    setMotionPending(true);
    try {
      const res = await fetch(`/api/today/motion?days=${days}`);
      if (!res.ok) throw new Error();
      setMotion(await res.json());
    } catch {
      toast.error("Couldn't load that period", {
        description: "The figures shown are still the last ones that loaded successfully.",
      });
    } finally {
      setMotionPending(false);
    }
  }

  const heatmapCard = (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Activity, last 14 days</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">Hover any cell for the day&apos;s detail</p>
        </div>
      </CardHeader>
      <CardContent>
        <ActivityHeatmap {...data.heatmap} />
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-[1600px] px-3 py-3 sm:px-4 sm:py-4">
      {/* Layout switcher */}
      <div className="mb-3 flex items-center justify-end">
        <div
          className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-sunken p-0.5"
          role="group"
          aria-label="Today layout"
        >
          {(
            [
              ["classic", "Classic", LayoutGrid],
              ["mission", "Mission Control", Radar],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => switchLayout(key)}
              aria-pressed={layout === key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors",
                layout === key
                  ? "bg-surface text-primary shadow-card"
                  : "text-muted hover:text-secondary"
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {layout === "classic" ? (
        <div className="space-y-3">
          <CopilotBrief
            greeting={greeting}
            firstName={firstName}
            brief={data.brief}
            onStartSession={() =>
              toast("Focus mode lands with My Queue", {
                description: "It will walk you through the worklist one item at a time.",
              })
            }
          />

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-3">
              <LeadOfTheDay lead={data.leadOfDay} />
              <RevenueInReach revenue={data.revenue} />
              <Worklist items={data.worklist} />
              {heatmapCard}
            </div>

            <div className="min-w-0 space-y-3">
              <SalesHealth health={data.health} />
              <AiSalesCoach coach={data.coach} />
              <WhileYouSlept digest={data.digest} />
              <RevenueInMotion motion={motion} onPeriodChange={changePeriod} pending={motionPending} />
              <MorningBriefing changes={data.brief.totalChanges} />
              <StickyNotes notes={data.notes} />
              <DemandIndexTeaser />
            </div>
          </div>
        </div>
      ) : (
        /* Mission Control: denser, three columns, worklist given the most room. */
        <div className="space-y-3">
          <CopilotBrief
            greeting={greeting}
            firstName={firstName}
            brief={data.brief}
            onStartSession={() =>
              toast("Focus mode lands with My Queue", {
                description: "It will walk you through the worklist one item at a time.",
              })
            }
          />

          <RevenueInReach revenue={data.revenue} />

          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[320px_minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-3 2xl:order-1">
              <SalesHealth health={data.health} />
              <RevenueInMotion motion={motion} onPeriodChange={changePeriod} pending={motionPending} />
              <StickyNotes notes={data.notes} />
            </div>

            <div className="min-w-0 space-y-3 lg:col-span-2 2xl:order-2 2xl:col-span-1">
              <Worklist items={data.worklist} />
              <LeadOfTheDay lead={data.leadOfDay} />
              {heatmapCard}
            </div>

            <div className="min-w-0 space-y-3 2xl:order-3">
              <WhileYouSlept digest={data.digest} />
              <AiSalesCoach coach={data.coach} />
              <MorningBriefing changes={data.brief.totalChanges} />
              <DemandIndexTeaser />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
