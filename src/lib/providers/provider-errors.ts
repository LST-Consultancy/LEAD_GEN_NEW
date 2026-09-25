// Kept out of http.ts so code that catches these still works where tests mock the HTTP module.

/** Why a provider request did not return data, so a caller can wait, stop or retry deliberately. */
export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly kind: "rate_limited" | "busy" | "http" | "network",
    readonly status: number | null = null,
    /** For an app-side limit, the window that refused: a minute can be waited out, a day cannot. */
    readonly windowSeconds: number | null = null,
    /** The provider's own error identifier from its body (e.g. Hunter's errors[0].id), when it sent one. */
    readonly providerCode: string | null = null,
  ) { super(message); }
}

/**
 * The provider's error identifier from a response body, and nothing else: an id or code, never the
 * free-text message, which can echo a query or an address back.
 */
export function providerErrorCode(body: string): string | null {
  try {
    const j = JSON.parse(body) as { errors?: { id?: unknown; code?: unknown }[]; error_code?: unknown; error?: unknown; code?: unknown };
    const v = j.errors?.[0]?.id ?? j.error_code ?? j.code ?? (typeof j.error === "string" && /^[a-z_]{3,60}$/i.test(j.error) ? j.error : null);
    return typeof v === "string" || typeof v === "number" ? String(v).slice(0, 60) : null;
  } catch { return null; }
}
