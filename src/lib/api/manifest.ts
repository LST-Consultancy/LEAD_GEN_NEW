/**
 * §65 — the public API surface, declared once.
 *
 * This list is the single source of truth for three things that must agree:
 * which endpoints accept an API key, which scope each one needs, and what the
 * API Keys and MCP screens tell an integrator. A separate hand-written table
 * of "endpoints we support" is exactly the kind of documentation that goes
 * stale silently, so the screens read this instead.
 *
 * `keyAuth: false` means the route exists but has not been wired for machine
 * callers yet. It is listed anyway, because an integrator needs to know the
 * difference between "not available" and "not documented".
 */

export type Endpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  /** The scope a key must hold. `null` means no key may call it at all. */
  scope: string | null;
  keyAuth: boolean;
  /** Why not, when `keyAuth` is false. */
  note?: string;
};

export const ENDPOINTS: Endpoint[] = [
  // ---- Wired for API keys --------------------------------------------
  {
    method: "POST",
    path: "/api/mcp",
    summary: "Model Context Protocol (Streamable HTTP, JSON-RPC 2.0): initialize, tools/list and tools/call for the read-only Copilot tools.",
    scope: "insights.read",
    keyAuth: true,
  },
  {
    method: "GET",
    path: "/api/leads/{id}",
    summary: "One lead with its score, evidence and contacts.",
    scope: "leads.read",
    keyAuth: true,
  },
  {
    method: "GET",
    path: "/api/search?q=",
    summary: "Search leads, companies and deals.",
    scope: "leads.read",
    keyAuth: true,
  },
  {
    method: "GET",
    path: "/api/deals",
    summary: "The pipeline, with stages, values and risk flags.",
    scope: "pipeline.read",
    keyAuth: true,
  },
  {
    method: "GET",
    path: "/api/today/motion",
    summary: "Revenue in reach, health and pipeline movement.",
    scope: "insights.read",
    keyAuth: true,
  },
  {
    method: "GET",
    path: "/api/proposals",
    summary: "Proposals with totals, view counts and decisions.",
    scope: "proposals.read",
    keyAuth: true,
  },
  {
    method: "GET",
    path: "/api/tasks",
    summary: "The ranked worklist.",
    scope: "leads.read",
    keyAuth: true,
  },
  {
    method: "PATCH",
    path: "/api/leads/{id}",
    summary: "Change a lead's status, owner, tier, value or next action.",
    scope: "leads.write",
    keyAuth: true,
  },
  {
    method: "POST",
    path: "/api/tasks",
    summary: "Create a task on a lead or deal.",
    scope: "leads.write",
    keyAuth: true,
  },
  {
    method: "GET",
    path: "/api/leads/{id}/reveal",
    summary: "Quote what revealing a lead's contacts would cost. Spends nothing.",
    scope: "contacts.reveal",
    keyAuth: true,
  },
  {
    method: "POST",
    path: "/api/leads/{id}/reveal",
    summary: "Reveal contacts. Spends points and cannot be undone.",
    scope: "contacts.reveal",
    keyAuth: true,
  },

  // ---- Session only, for now -----------------------------------------
  {
    method: "POST",
    path: "/api/sequences/{id}/enroll",
    summary: "Enrol leads in an outreach sequence.",
    scope: "outreach.send",
    keyAuth: false,
    note: "Not wired for keys yet. Enrolling reaches real people, so it is session-only until the consent flow is built.",
  },
  {
    method: "PUT",
    path: "/api/autopilot",
    summary: "Change what agents are allowed to do.",
    scope: null,
    keyAuth: false,
    note: "Deliberately never available to a key. Changing the guardrails must be a person's decision.",
  },
  {
    method: "POST",
    path: "/api/agent-actions/{id}/decide",
    summary: "Approve or overrule an agent action.",
    scope: null,
    keyAuth: false,
    note: "Deliberately never available to a key. Approval exists to put a human in the loop; a key approving on their behalf would defeat it.",
  },
];

export const KEY_ENDPOINTS = ENDPOINTS.filter((e) => e.keyAuth);

/** Endpoints a key holding these scopes could call. */
export function endpointsForScopes(scopes: string[]): Endpoint[] {
  return KEY_ENDPOINTS.filter((e) => e.scope !== null && scopes.includes(e.scope));
}

/** Grouped for display: what this scope unlocks. */
export function endpointsByScope(): Record<string, Endpoint[]> {
  const out: Record<string, Endpoint[]> = {};
  for (const e of KEY_ENDPOINTS) {
    if (!e.scope) continue;
    (out[e.scope] ??= []).push(e);
  }
  return out;
}
