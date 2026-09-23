"use client";

/**
 * Thin typed wrapper over fetch for the app's own API.
 *
 * Its one job beyond fetching is to turn a failed response into an Error
 * carrying the message the server already wrote for a person to read, so call
 * sites can surface it directly instead of inventing their own wording.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
    /**
     * The server's id for this request, taken from the response header.
     *
     * Carried so an error surface can show something a person can quote. A
     * support report that says "it failed this afternoon" cannot be looked up;
     * one that quotes this lands on a single log line.
     */
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True when retrying might work; false for validation and permission faults. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "We couldn't reach the server. Check your connection and try again — nothing was changed.",
      "network_error",
      0
    );
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const err = payload?.error;
    throw new ApiError(
      err?.message ?? "Something went wrong. Nothing was changed.",
      err?.code ?? "unknown_error",
      res.status,
      err?.details,
      // Prefer the header: it is set for every response, including the ones
      // that never reached a route handler.
      res.headers.get("x-request-id") ?? err?.requestId
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  // PUT replaces a whole resource, PATCH amends part of one. Several routes
  // are PUT (`/api/sequences/[id]`, `/api/proposals/[id]`, `/api/autopilot`)
  // and had no client method, so nothing could call them.
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  // A body on DELETE is unusual but correct here: disabling MFA sends a
  // one-time code, and a query string would put that credential in server logs
  // and browser history.
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------

export type RevealQuote = {
  leadId: string;
  chargeable: { id: string; kind: string; status: string; confidence: number }[];
  cost: number;
};

export type RevealResult = {
  leadId: string;
  revealed: { id: string; kind: string; value: string; status: string }[];
  pointsSpent: number;
  balance: number;
  skipped: { kind: string; reason: string }[];
};

export const leadsApi = {
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<{ id: string }>(`/api/leads/${id}`, body),
  quoteReveal: (id: string) => api.get<RevealQuote>(`/api/leads/${id}/reveal`),
  reveal: (id: string, body?: { contactMethodIds?: string[]; idempotencyKey?: string }) =>
    api.post<RevealResult>(`/api/leads/${id}/reveal`, body),
  archive: (id: string) => api.post<{ id: string }>(`/api/leads/${id}/archive`),
  restore: (id: string) => api.post<{ id: string }>(`/api/leads/${id}/restore`),
  discard: (id: string, reason: string) =>
    api.post<{ id: string }>(`/api/leads/${id}/discard`, { reason }),
  overrideScore: (id: string, score: number | null, reason?: string) =>
    api.patch<{ leadId: string; computedScore: number; overriddenScore: number | null }>(
      `/api/leads/${id}/score`,
      { score, reason }
    ),
  addNote: (id: string, body: string) =>
    api.post<{ id: string; body: string }>(`/api/leads/${id}/notes`, { body }),
};

export const tasksApi = {
  create: (body: Record<string, unknown>) => api.post<{ id: string }>("/api/tasks", body),
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<{ id: string; status: string; lane: string }>(`/api/tasks/${id}`, body),
  complete: (id: string) => tasksApi.update(id, { status: "DONE" }),
  snooze: (id: string, until: Date) => tasksApi.update(id, { snoozedUntil: until.toISOString() }),
  remove: (id: string) => api.del<{ id: string }>(`/api/tasks/${id}`),
};

export const dealsApi = {
  create: (body: Record<string, unknown>) => api.post<{ id: string }>("/api/deals", body),
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<{ id: string }>(`/api/deals/${id}`, body),
  moveStage: (id: string, toStageId: string, lostReason?: string) =>
    api.patch<{ id: string; stageId: string; stageName: string; status: string }>(
      `/api/deals/${id}/stage`,
      { toStageId, lostReason }
    ),
  remove: (id: string) => api.del<{ id: string }>(`/api/deals/${id}`),
};

export const notesApi = {
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<{ id: string }>(`/api/notes/${id}`, body),
  remove: (id: string) => api.del<{ id: string }>(`/api/notes/${id}`),
};
