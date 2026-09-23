import "server-only";
import { db } from "@/lib/db";
import { estimateCostInr, isPriced } from "@/lib/ai/pricing";

export { estimateCostInr, isPriced } from "@/lib/ai/pricing";
import {
  activeProvider,
  isConfigured,
  modelFor,
  FEATURE_TIER,
  type ProviderName,
} from "@/lib/ai/provider";

/**
 * §87 / §89 — the one place that actually calls a model.
 *
 * Deliberately a plain `fetch` rather than a vendor SDK: the provider
 * abstraction exists so swapping one is a change here only, and an SDK would
 * spread its types through every caller.
 *
 * Three properties the rest of the app depends on:
 *
 *  1. **It never throws.** A model outage must degrade a feature, not break a
 *     page. Every failure comes back as `{ ok: false, reason }` with a
 *     sentence written for the person who will read it.
 *  2. **Every call is logged** with tokens, latency and estimated cost, so
 *     Settings → AI Assistant reports real spend rather than an estimate of an
 *     estimate.
 *  3. **It carries no product opinions.** Prompts live with the features that
 *     own them.
 */

export type CompletionRequest = {
  /** Which feature is asking. Routes the model tier and labels the log. */
  feature: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Aborts and returns a failure rather than hanging a request. */
  timeoutMs?: number;
};

export type CompletionResult =
  | {
      ok: true;
      text: string;
      model: string;
      provider: ProviderName;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      estimatedCostInr: number;
    }
  | {
      ok: false;
      reason: string;
      code:
        | "not_configured"
        | "timeout"
        | "rate_limited"
        | "auth_failed"
        | "provider_error"
        | "truncated"
        | "timed_out"
        | "empty_response";
      latencyMs: number;
    };

export async function complete(
  ctx: { workspaceId: string; userId: string | null },
  req: CompletionRequest
): Promise<CompletionResult> {
  const started = Date.now();
  const provider = activeProvider();
  const model = modelFor(req.feature, provider);

  if (!isConfigured(provider)) {
    return {
      ok: false,
      code: "not_configured",
      reason: "No model provider is connected, so nothing can be generated.",
      latencyMs: 0,
    };
  }

  const budgetMs = req.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), budgetMs);

  try {
    /*
     * Raced against a timer rather than relying on the abort alone.
     *
     * Aborting a `fetch` signals intent; it does not guarantee the promise
     * settles promptly. Measured here: a request with the signal aborted at 25
     * seconds only rejected after 603, because the abort could not tear the
     * socket down until the response finally arrived. Every caller had been
     * told this call was bounded, and a page awaiting it hung for ten minutes.
     *
     * The race releases the caller on time whatever the socket does. The abort
     * is still fired, so the request is abandoned rather than left running.
     */
    const result = await Promise.race([
      callProvider(provider, model, req, controller.signal),
      new Promise<ProviderOutcome>((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: false,
              code: "timed_out",
              reason: `The model did not answer within ${Math.round(budgetMs / 1000)} seconds, so the request was abandoned. Nothing was generated.`,
            }),
          budgetMs
        )
      ),
    ]);
    clearTimeout(timeout);
    const latencyMs = Date.now() - started;

    if (!result.ok) {
      await log(ctx, req.feature, provider, model, latencyMs, false, result.code, 0, 0);
      return { ...result, latencyMs };
    }

    const estimatedCostInr = estimateCostInr(model, result.inputTokens, result.outputTokens);
    await log(
      ctx,
      req.feature,
      provider,
      model,
      latencyMs,
      true,
      null,
      result.inputTokens,
      result.outputTokens,
      estimatedCostInr
    );

    return {
      ok: true,
      text: result.text,
      model,
      provider,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs,
      estimatedCostInr,
    };
  } catch (err) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - started;
    const aborted = err instanceof Error && err.name === "AbortError";
    const code = aborted ? "timeout" : "provider_error";
    await log(ctx, req.feature, provider, model, latencyMs, false, code, 0, 0);

    return {
      ok: false,
      code,
      reason: aborted
        ? `The model did not answer within ${Math.round((req.timeoutMs ?? 30_000) / 1000)} seconds. Nothing was generated.`
        : `The model provider could not be reached. Nothing was generated.`,
      latencyMs,
    };
  }
}

type ProviderOutcome =
  | { ok: true; text: string; inputTokens: number; outputTokens: number }
  | {
      ok: false;
      code:
        | "rate_limited"
        | "auth_failed"
        | "provider_error"
        | "truncated"
        | "timed_out"
        | "empty_response";
      reason: string;
    };

async function callProvider(
  provider: ProviderName,
  model: string,
  req: CompletionRequest,
  signal: AbortSignal
): Promise<ProviderOutcome> {
  if (provider !== "anthropic") {
    // Only one adapter is built. Saying so beats a generic failure.
    return {
      ok: false,
      code: "provider_error",
      reason: `${provider} is selected but only the Anthropic adapter is built in this version. Set AI_DEFAULT_PROVIDER=anthropic, or the feature stays unavailable.`,
    };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    // No `temperature`: the Claude 5 models reject it outright, and grounding
    // is enforced by the system prompt rather than by a sampling knob.
    body: JSON.stringify({
      model,
      // Generous, because thinking tokens are drawn from the same budget:
      // a limit sized for the answer alone yields an empty reply.
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: "auth_failed",
        reason:
          "The model provider rejected the API key. Check it in Settings → AI Assistant; nothing was generated.",
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        code: "rate_limited",
        reason: "The model provider is rate limiting this workspace. Nothing was generated; try again shortly.",
      };
    }
    return {
      ok: false,
      code: "provider_error",
      reason: `The model provider returned ${response.status}. Nothing was generated.${body ? ` (${body.slice(0, 160)})` : ""}`,
    };
  }

  const json = (await response.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  // These models emit a `thinking` block before the answer, and its tokens
  // count against `max_tokens`. Only `text` blocks are the reply; joining
  // everything would put the model's reasoning in front of the user.
  const text = (json.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();

  if (text.length === 0) {
    // Ran out of budget before producing any answer, almost always because
    // thinking consumed it. That is a different fault from a model that
    // answered with nothing, and it has a different fix — raise `maxTokens` —
    // so it is reported separately rather than as a generic empty reply.
    if (json.stop_reason === "max_tokens") {
      return {
        ok: false,
        code: "truncated",
        reason:
          "The reply was cut off before any of it came back, so nothing usable was produced. Nothing was saved.",
      };
    }
    return {
      ok: false,
      code: "empty_response",
      reason: "The model returned nothing. Rather than show an empty answer, this is reported as a failure.",
    };
  }

  return {
    ok: true,
    text,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}

async function log(
  ctx: { workspaceId: string; userId: string | null },
  feature: string,
  provider: string,
  model: string,
  latencyMs: number,
  success: boolean,
  errorCode: string | null,
  inputTokens: number,
  outputTokens: number,
  estimatedCostInr = 0
) {
  try {
    await db.aIRequestLog.create({
      data: {
        workspaceId: ctx.workspaceId,
        feature,
        provider,
        model,
        latencyMs,
        inputTokens,
        outputTokens,
        estimatedCostInr,
        success,
        errorCode,
        actorType: ctx.userId ? "HUMAN" : "SYSTEM",
        actorUserId: ctx.userId,
      },
    });
  } catch {
    // Observability must never break the request it observes.
  }
}

/**
 * Which features are wired to a model, and which one each would use.
 *
 * A feature is listed here only once it actually calls `complete()`. The
 * settings screen reads this, so it cannot advertise a model-backed feature
 * that no code path reaches.
 */
const WIRED_FEATURES = [
  // Adding a name here without a call site would put a model-backed feature on
  // the settings screen that nothing can actually run, so
  // `wired-features.test.ts` scans the source for the call.
  "natural_language_analytics",
  "draft_outreach",
  "lead_verdict",
  "summarise_thread",
  "proposal_draft",
  "coach_tip",
  "daily_brief",
  "account_plan",
  "buyer_attribution",
] as const;

export function modelPlan(): { feature: string; model: string; priced: boolean }[] {
  const provider = activeProvider();
  return WIRED_FEATURES.map((feature) => {
    const model = modelFor(feature, provider);
    return { feature, model, priced: isPriced(model) };
  });
}

/** Every feature the routing table knows, wired or not, for the same screen. */
export function allRoutedFeatures(): { feature: string; model: string; wired: boolean }[] {
  const provider = activeProvider();
  return Object.keys(FEATURE_TIER).map((feature) => ({
    feature,
    model: modelFor(feature, provider),
    wired: (WIRED_FEATURES as readonly string[]).includes(feature),
  }));
}
