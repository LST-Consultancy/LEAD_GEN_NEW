import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { log } from "@/lib/observability/log";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { ForbiddenError } from "@/lib/auth/context";
import { InsufficientPointsError } from "@/lib/services/points";
import { MutationError } from "@/lib/services/mutate";

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown; requestId?: string };
};

/**
 * The id middleware attached to this request.
 *
 * Read lazily and defensively: `headers()` throws outside a request scope, and
 * an error response is the last place that should itself throw.
 */
async function currentRequestId(): Promise<string | undefined> {
  try {
    return (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * §127 — API errors carry a machine code and a sentence a person can act on.
 * Where money is involved the message states the financial consequence.
 */
export function apiError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
  requestId?: string
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, details, requestId } }, { status });
}

export function unauthorized() {
  return apiError("unauthorized", "Please sign in again — your session has expired.", 401);
}

/**
 * §103 — a refused request says when to try again, so a client can back off
 * rather than retry into the same wall.
 */
export function tooManyRequests(resetSeconds: number, what = "requests") {
  const res = apiError(
    "rate_limited",
    `Too many ${what}. Try again in ${resetSeconds} ${resetSeconds === 1 ? "second" : "seconds"}. Nothing was changed.`,
    429
  );
  res.headers.set("Retry-After", String(resetSeconds));
  return res;
}

export function notFound(what = "That record") {
  return apiError("not_found", `${what} doesn't exist, or you don't have access to it.`, 404);
}

/** Maps known error types to honest responses; anything else becomes a 500. */
export async function handleApiError(err: unknown): Promise<NextResponse<ApiErrorBody>> {
  if (err instanceof ZodError) {
    return apiError("invalid_request", "Some of those values weren't valid.", 400, err.flatten());
  }
  if (err instanceof ForbiddenError) {
    return apiError(
      "forbidden",
      "Your role doesn't allow this. Ask a workspace admin if you need it.",
      403,
      { permission: err.permission }
    );
  }
  if (err instanceof MutationError) {
    // The service layer already phrased these for a person to read.
    return apiError(err.code, err.message, err.status);
  }
  if (err instanceof InsufficientPointsError) {
    return apiError(
      "insufficient_points",
      `This needs ${err.required} ${err.required === 1 ? "point" : "points"} and you have ${err.available}. Nothing was charged.`,
      402,
      { required: err.required, available: err.available }
    );
  }
  // The only branch that is genuinely a fault rather than a refusal, so it is
  // the only one logged at error level — and the only one that shows the id,
  // because it is the only one worth reporting.
  const requestId = await currentRequestId();
  log.api.error("unhandled error", { err, requestId });
  return apiError(
    "internal_error",
    // The id is in the sentence because this is the one failure a person is
    // expected to report, and "it broke around four o'clock" is not findable.
    `Something went wrong on our side. Nothing was changed and no points were charged.${
      requestId ? ` Quote reference ${requestId} if you report this.` : ""
    }`,
    500,
    undefined,
    requestId
  );
}
