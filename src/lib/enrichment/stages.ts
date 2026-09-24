/**
 * The stages of opportunity enrichment and how a run's overall state follows from them. Shared by
 * the worker and the screen, so the label a person reads is computed from the same outcome the
 * worker recorded. No server imports.
 */
export const STAGE_KEYS = ["resolve", "details", "people", "emails", "verify", "summary"] as const;
export type StageKey = typeof STAGE_KEYS[number];
export const RUN_KINDS = ["research", "people", "emails", "verify", "enrich"] as const;
export type RunKind = typeof RUN_KINDS[number];

/** Each button runs its own stages plus the prerequisites; a prerequisite already done is skipped, not repeated. */
export const PLAN: Record<RunKind, StageKey[]> = {
  research: ["resolve", "details", "summary"],
  people: ["resolve", "details", "people"],
  emails: ["resolve", "details", "emails"],
  verify: ["verify"],
  enrich: ["resolve", "details", "people", "emails", "verify", "summary"],
};
/** The stage whose result decides "completed with results" versus "no matches" for each button. */
export const MAIN: Record<RunKind, StageKey[]> = { research: ["resolve", "details"], people: ["people"], emails: ["emails"], verify: ["verify"], enrich: ["resolve", "details", "people", "emails"] };

export type StageStatus = "pending" | "running" | "done" | "no_matches" | "skipped" | "needs_selection" | "blocked" | "failed" | "cancelled";
export type Stage = { key: StageKey; status: StageStatus; counts: Record<string, number>; reason?: string; startedAt?: string; finishedAt?: string; estimatedUsd?: number; usageUsd?: number | null };
export type RunState = "QUEUED" | "RUNNING" | "COMPLETED" | "NO_MATCHES" | "PARTIAL" | "NEEDS_SELECTION" | "FAILED" | "CANCELLED";
export const TERMINAL: RunState[] = ["COMPLETED", "NO_MATCHES", "PARTIAL", "NEEDS_SELECTION", "FAILED", "CANCELLED"];

export const STAGE_LABEL: Record<StageKey, { running: string; done: string }> = {
  resolve: { running: "Resolving company", done: "Company identified" },
  details: { running: "Saving company details", done: "Company details saved" },
  people: { running: "Finding relevant people", done: "People saved" },
  emails: { running: "Discovering emails", done: "Emails discovered" },
  verify: { running: "Checking emails", done: "Emails checked" },
  summary: { running: "Writing a summary", done: "Summary written" },
};
export const RUN_STATE_LABEL: Record<RunState, { label: string; variant: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  QUEUED: { label: "Queued", variant: "neutral" }, RUNNING: { label: "Running", variant: "info" },
  COMPLETED: { label: "Completed with results", variant: "success" }, NO_MATCHES: { label: "Completed with no matches", variant: "neutral" },
  PARTIAL: { label: "Partially completed", variant: "warning" }, NEEDS_SELECTION: { label: "Needs company selection", variant: "warning" },
  FAILED: { label: "Failed", variant: "danger" }, CANCELLED: { label: "Cancelled", variant: "neutral" },
};

export const freshStages = (kind: RunKind): Stage[] => PLAN[kind].map(key => ({ key, status: "pending", counts: {} }));

/** The run's state from its stages. A failure after some success is partial, never a clean failure or success. */
export function runStateOf(kind: RunKind, stages: Stage[]): RunState {
  if (stages.some(s => s.status === "cancelled")) return "CANCELLED";
  if (stages.some(s => s.status === "needs_selection")) return "NEEDS_SELECTION";
  if (stages.some(s => s.status === "pending" || s.status === "running")) return "RUNNING";
  const produced = stages.some(s => s.status === "done");
  if (stages.some(s => s.status === "failed")) return produced ? "PARTIAL" : "FAILED";
  const main = stages.filter(s => MAIN[kind].includes(s.key));
  // Everything already fresh is a completed run with nothing new to do, not "no matches".
  return main.some(s => s.status === "done") || main.every(s => s.status === "skipped") ? "COMPLETED" : "NO_MATCHES";
}
