import { NextResponse, type NextRequest } from "next/server";
import { getMyQueue } from "@/lib/services/queue";
import { createTask, createTaskSchema } from "@/lib/services/tasks";
import { handleApiError } from "@/lib/api/respond";
import { resolveCaller } from "@/lib/api/caller";

export async function GET(req: NextRequest) {
  try {
    // Accepts a browser session or an API key holding "leads.read".
    const caller = await resolveCaller(req.headers, { scope: "leads.read" });
    if (!caller.ok) return caller.response;
    const ctx = caller.ctx;
    return NextResponse.json(await getMyQueue(ctx));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    // Accepts a browser session or an API key holding "leads.write".
    const caller = await resolveCaller(req.headers, { scope: "leads.write" });
    if (!caller.ok) return caller.response;
    const ctx = caller.ctx;
    const input = createTaskSchema.parse(await req.json());
    return NextResponse.json(await createTask(ctx, input), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
