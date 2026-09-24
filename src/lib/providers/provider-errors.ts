// Kept out of http.ts so code that catches these still works where tests mock the HTTP module.

/** Why a provider request did not return data, so a caller can wait, stop or retry deliberately. */
export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly kind: "rate_limited" | "busy" | "http" | "network",
    readonly status: number | null = null,
    /** For an app-side limit, the window that refused: a minute can be waited out, a day cannot. */
    readonly windowSeconds: number | null = null,
  ) { super(message); }
}
