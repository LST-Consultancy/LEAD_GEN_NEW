import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth/context";
import { getToday } from "@/lib/services/today";
import { getDemandByType } from "@/lib/services/opportunities";
import { greeting } from "@/lib/format";
import { TodayView } from "./today-view";
import { morningBriefing } from "@/lib/services/voice";
import { VoicePlayer } from "@/components/voice/voice-player";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const ctx = await requireAuth();
  const [data, demand, briefing] = await Promise.all([getToday(ctx), getDemandByType(ctx).catch(() => undefined), morningBriefing(ctx).catch(() => null)]);

  const layout =
    (await cookies()).get("sr_today_layout")?.value === "mission" ? "mission" : "classic";

  return (
    <>
    {briefing ? <details className="mx-3 mt-3 rounded-lg border border-border bg-surface px-3 py-2 sm:mx-4"><summary className="cursor-pointer text-xs font-medium text-primary">Morning briefing — listen</summary><div className="pt-2"><VoicePlayer script={briefing.script} serverAudio={briefing.serverAudio} voices={briefing.voices} purpose="briefing" title="Read from today's figures" /></div></details> : null}
    <TodayView
      greeting={greeting(new Date(), ctx.user.timezone)}
      firstName={ctx.user.name.split(" ")[0]}
      data={data}
      initialLayout={layout}
      demand={demand}
    />
    </>
  );
}
