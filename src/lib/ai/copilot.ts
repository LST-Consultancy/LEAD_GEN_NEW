import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import { TOOLS, routeQuestion, type Evidence } from "@/lib/ai/tools";
import { complete } from "@/lib/ai/complete";

/**
 * §62 — the Copilot's free-form path.
 *
 * The rule that makes this safe to ship: **the model never sees the question
 * without the data, and is told it may only use the data.** Every READ tool
 * runs first, its output becomes the context, and the answer is accompanied by
 * the same rows on screen. That keeps §72 intact — a number the Copilot says
 * is a number the user can click through to.
 *
 * The model's job here is to *read* rows and phrase an answer. It is not
 * asked to calculate, estimate or recall anything.
 */

const SYSTEM = `You answer questions about a B2B sales workspace for a sales team in India.

You are given a CONTEXT block containing real figures read from the user's own database moments ago. Those figures are the only facts you have.

Rules you must follow exactly:
- Use only numbers, names and dates that appear in CONTEXT. Never calculate a new number from them, never estimate, never round differently, and never recall anything from training.
- If CONTEXT does not contain what the question needs, say so plainly in one sentence and name what is missing. Do not guess and do not offer a general answer instead.
- Quote figures exactly as written, including currency formatting like ₹1.2Cr.
- Be brief: two or three sentences. This is read between calls, not studied.
- Write plainly. No preamble, no "Based on the context", no bullet lists unless comparing three or more things.
- Indian English and Indian number formatting (lakh, crore).`;

export type CopilotAnswer = {
  text: string;
  evidence: Evidence[];
  /** Which tools were read to build the context. */
  grounding: { name: string; riskClass: string }[];
  model: string | null;
  /** True when the answer came from one tool directly, without a model call. */
  direct: boolean;
  unavailable?: boolean;
  costInr?: number;
  /**
   * The tool a declined question matched. Declining correctly is the system
   * working, not failing — without this the log has no name for what happened
   * and files it under "unknown failure".
   */
  declinedTool?: string;
};

/**
 * Answers a question.
 *
 * Routes to a single tool when one clearly matches — that path needs no model
 * and its answer is the tool's own sentence, which is the most trustworthy
 * form of all. Otherwise it reads every available tool and asks the model to
 * phrase an answer from what came back.
 */
export async function answerQuestion(
  ctx: AuthContext,
  question: string
): Promise<CopilotAnswer> {
  const routed = routeQuestion(question);

  // One tool answers it outright. No model involved, so nothing can drift.
  if (routed?.implemented && routed.run) {
    const result = await routed.run(ctx);
    return {
      text: result.text,
      evidence: result.evidence ?? [],
      grounding: [{ name: routed.name, riskClass: routed.riskClass }],
      model: null,
      direct: true,
    };
  }

  // A tool matched but is not built. Say that rather than reaching for a model.
  if (routed && !routed.implemented) {
    return {
      text: `That maps to the \`${routed.name}\` tool — ${routed.description} It isn't built yet, so I won't pretend to have done it. Nothing was changed.`,
      evidence: [],
      grounding: [],
      model: null,
      direct: true,
      unavailable: true,
      declinedTool: routed.name,
    };
  }

  // A built tool matched, but it changes something. Only READ tools carry
  // `run`; everything else takes structured input and goes through the agent
  // runner, where the guardrails and the approval queue apply. Without this
  // branch the request falls through to the general model answer, and asking
  // "add a note to Kaveri" silently returns a pipeline summary instead.
  if (routed?.implemented && !routed.run) {
    return {
      text: `That maps to the \`${routed.name}\` tool, which changes something rather than reading it. The Copilot only reads. Run it from an agent, where the budget, the guardrails and the approval queue apply — nothing was changed here.`,
      evidence: [],
      grounding: [],
      model: null,
      direct: true,
      unavailable: true,
      declinedTool: routed.name,
    };
  }

  // Nothing matched cleanly. Read everything available and let the model phrase
  // an answer from it.
  const readable = TOOLS.filter((t) => t.riskClass === "READ" && t.implemented && t.run);
  const readings = await Promise.all(
    readable.map(async (t) => {
      try {
        const result = await t.run!(ctx);
        return { tool: t, result };
      } catch {
        // One failing tool must not lose the others.
        return null;
      }
    })
  );
  const usable = readings.filter((r): r is NonNullable<typeof r> => r !== null);

  if (usable.length === 0) {
    return {
      text: "I could not read anything from your workspace just now, so I have nothing to answer from.",
      evidence: [],
      grounding: [],
      model: null,
      direct: false,
      unavailable: true,
    };
  }

  const context = usable
    .map((r) => {
      const lines = (r.result.evidence ?? []).map(
        (e) => `  - ${e.label}${e.detail ? `: ${e.detail}` : ""}`
      );
      return `[${r.tool.name}] ${r.result.text}${lines.length ? `\n${lines.join("\n")}` : ""}`;
    })
    .join("\n\n");

  const completion = await complete(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    {
      feature: "natural_language_analytics",
      system: SYSTEM,
      prompt: `CONTEXT (read from the database just now):\n\n${context}\n\nQUESTION: ${question}`,
      maxTokens: 400,
      timeoutMs: 20_000,
    }
  );

  const evidence = usable.flatMap((r) => r.result.evidence ?? []);
  const grounding = usable.map((r) => ({ name: r.tool.name, riskClass: r.tool.riskClass }));

  if (!completion.ok) {
    return {
      // The failure is reported, and the rows are still shown — they are the
      // useful part and they were read successfully.
      text: `${completion.reason} The figures below were read from your data and are unaffected.`,
      evidence,
      grounding,
      model: null,
      direct: false,
      unavailable: true,
    };
  }

  return {
    text: completion.text,
    evidence,
    grounding,
    model: completion.model,
    direct: false,
    costInr: completion.estimatedCostInr,
  };
}
