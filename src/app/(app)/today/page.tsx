import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth/context";
import { getToday } from "@/lib/services/today";
import { greeting } from "@/lib/format";
import { TodayView } from "./today-view";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const ctx = await requireAuth();
  const data = await getToday(ctx);

  const layout =
    (await cookies()).get("sr_today_layout")?.value === "mission" ? "mission" : "classic";

  return (
    <TodayView
      greeting={greeting(new Date(), ctx.user.timezone)}
      firstName={ctx.user.name.split(" ")[0]}
      data={data}
      initialLayout={layout}
    />
  );
}
