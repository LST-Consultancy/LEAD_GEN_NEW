import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/auth/context";
import { handleApiError, tooManyRequests, unauthorized } from "@/lib/api/respond";
import { rateLimit } from "@/lib/security/rate-limit";
import { answerQuestion } from "@/lib/ai/copilot";
import { recordAudit } from "@/lib/services/audit";

const schema = z.object({ question: z.string().trim().min(1).max(1000) });

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    const { question } = schema.parse(await req.json());

    // Keyed per workspace, not per user: the cost lands on the workspace's
    // bill, and one person looping a script should not be able to spend the
    // team's budget faster than the team agreed to.
    const limit = await rateLimit("ai", `ws:${ctx.workspaceId}`);
    if (!limit.allowed) return tooManyRequests(limit.resetSeconds, "questions");

    await recordAudit(ctx, {
      action: "copilot.asked",
      objectType: "AIInsight",
      after: { question },
      actorType: "HUMAN",
    });

    // One path for everything. The Copilot decides whether a single tool
    // answers it, whether a tool exists but is unbuilt, or whether the model
    // should phrase an answer from every readable tool's output.
    const answer = await answerQuestion(ctx, question);

    if (answer.direct) {
      // A decline is the Copilot working correctly, so it is logged as a
      // success against the tool it matched. Logging it as a failure put
      // honest refusals in the "recent failures" panel, which both overstates
      // how often the system breaks and trains people to ignore that panel.
      const tool = answer.grounding[0]?.name ?? answer.declinedTool;
      await logRequest(
        ctx.workspaceId,
        ctx.userId,
        tool ? `copilot.${tool}` : "copilot.unmatched",
        Date.now() - started,
        true
      );
    }

    return NextResponse.json({
      text: answer.text,
      evidence: answer.evidence,
      grounding: answer.grounding,
      model: answer.model,
      direct: answer.direct,
      unavailable: answer.unavailable ?? false,
      costInr: answer.costInr,
      tool: answer.grounding[0]
        ? { name: answer.grounding[0].name, riskClass: answer.grounding[0].riskClass }
        : undefined,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

async function logRequest(
  workspaceId: string,
  userId: string,
  feature: string,
  latencyMs: number,
  success: boolean
) {
  try {
    await db.aIRequestLog.create({
      data: {
        workspaceId,
        feature,
        // A routed question is answered from the tool registry alone: no
        // provider is called, so naming one here would put a vendor and a
        // model on a row that cost nothing and generated nothing.
        provider: "none",
        model: "tool-router",
        latencyMs,
        success,
        actorType: "HUMAN",
        actorUserId: userId,
      },
    });
  } catch {
    // Observability must never break the request it observes.
  }
}
