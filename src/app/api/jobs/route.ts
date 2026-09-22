import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { getJobMonitor, triggerJob } from "@/lib/services/jobs";
import { TRIGGERABLE_JOBS } from "@/lib/queue/jobs";
import { apiError, handleApiError, unauthorized } from "@/lib/api/respond";

// The allow-list and the reasons behind it live in the job catalogue, so the
// route and the monitor cannot disagree about which button exists.
const schema = z.object({
  job: z.string().refine((j): j is (typeof TRIGGERABLE_JOBS)[number] =>
    (TRIGGERABLE_JOBS as string[]).includes(j)
  ),
});

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    return NextResponse.json(await getJobMonitor(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { job } = schema.parse(await req.json());
    const result = await triggerJob(ctx, job);
    if (!result.queued) {
      return apiError("queue_unavailable", result.detail, 503);
    }
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
