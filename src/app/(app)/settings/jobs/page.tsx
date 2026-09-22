import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getJobMonitor } from "@/lib/services/jobs";
import { JobsView } from "./jobs-view";

export const metadata: Metadata = { title: "Background Jobs" };

export default async function JobsPage() {
  const ctx = await requireAuth();
  const monitor = await getJobMonitor(ctx);
  return <JobsView initial={monitor} />;
}
